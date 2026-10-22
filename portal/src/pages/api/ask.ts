import type { APIRoute } from 'astro';
import Anthropic from '@anthropic-ai/sdk';
import { buildKnowledgeBase } from '../../lib/knowledge';
import { serviceClient } from '../../lib/admin';
import { buildMessages, client, costUsd, DECLINE, FULL_CONTEXT_LIMIT, loadHouseRules, MODEL, searchPassages, sourcesFor, systemPrompt, validateTurns, type ChatTurn, type SourceRef } from '../../lib/ask';
import { checkAskAllowed, loadLimits, precheckOnTopic, PRECHECK_MODEL } from '../../lib/ask-limits';

/**
 * Streams an Ask Lakeba answer as server-sent events:
 *   data: {"text": "..."}        pieces of the answer as they are written
 *   data: {"sources": [...]}     once, at the end
 *   data: {"exchange": "<id>"}   the stored record, so the answer can be rated
 *   data: {"error": "..."}       if something went wrong
 * Every exchange is stored for admin review (Admin → Ask review).
 * Cost protection (lib/ask-limits.ts) runs before anything reaches Claude.
 */
export const POST: APIRoute = async ({ request, locals, url }) => {
  if (request.headers.get('origin') !== url.origin) return new Response('Forbidden', { status: 403 });
  const supabase = locals.supabase;

  // Ask Lakeba answers from Lakeba Group's documents, so it is for people who can see the group.
  const { data: groupId } = await supabase.rpc('group_entity_id');
  const { data: member } = groupId ? await supabase.rpc('can_see_entity', { target: groupId }) : { data: false };
  if (!member) return Response.json({ error: 'Ask Lakeba is available to Lakeba Group shareholders.' }, { status: 403 });

  const body = await request.json().catch(() => null);
  const turns = body?.turns as ChatTurn[];
  const conversationId = /^[0-9a-f-]{36}$/.test(body?.conversationId ?? '') ? body.conversationId : crypto.randomUUID();
  const invalid = validateTurns(turns);
  if (invalid) return Response.json({ error: invalid }, { status: 400 });

  const svc = serviceClient();
  const limits = await loadLimits(svc);
  const gate = await checkAskAllowed(svc, locals.user!.id, limits, url.origin);
  if (!gate.ok) return Response.json({ error: gate.error }, { status: gate.status });
  await supabase.rpc('log_event', { event_action: 'ask_question', event_detail: { length: turns.at(-1)!.content.length, turn: Math.ceil(turns.length / 2) } });

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (payload: object) => {
        try { controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`)); } catch { /* browser went away */ }
      };
      // What gets stored for review once the answer is complete (or stopped).
      const record: { answer: string; sources: SourceRef[]; error: string | null; usage: Record<string, unknown> } = { answer: '', sources: [], error: null, usage: {} };
      try {
        if (!client || gate.budgetReached) {
          // AI answers off or today's budget used: point to the most relevant passages instead.
          const passages = await searchPassages(supabase, turns.at(-1)!.content);
          const why = !client ? 'AI answers are not switched on yet.' : 'Ask Lakeba has reached its daily limit for AI answers; they resume at midnight (Sydney time).';
          record.answer = passages.length ? `${why} These passages look most relevant:` : `${why} No published document matches that question.`;
          record.sources = passages.map((p) => ({ title: p.title, detail: p.page ? `page ${p.page}` : null, href: `/documents/${p.document_id}` }));
          record.error = !client ? 'ai_off' : 'budget';
          send({ text: record.answer });
          send({ sources: record.sources });
          return;
        }
        // Cheap pre-check: clearly off-topic questions are declined without sending the knowledge base.
        if (limits.precheck) {
          const check = await precheckOnTopic(turns);
          if (!check.onTopic) {
            record.answer = DECLINE;
            record.usage = { model: PRECHECK_MODEL, cost_usd: check.costUsd };
            send({ text: DECLINE });
            send({ sources: [] });
            return;
          }
          record.usage = { cost_usd: check.costUsd };
        }
        const [kb, houseRules] = await Promise.all([buildKnowledgeBase(), loadHouseRules(svc)]);
        if (kb.approxTokens > FULL_CONTEXT_LIMIT) throw new Error('Knowledge base too large to send in full');
        const response = client.beta.messages.stream({
          model: MODEL,
          max_tokens: limits.maxAnswerTokens,
          output_config: { effort: 'medium' },
          // Re-runs on a fallback model if a safety classifier declines.
          betas: ['server-side-fallback-2026-07-01'],
          fallbacks: 'default',
          system: systemPrompt(houseRules),
          messages: buildMessages(kb, turns),
        }, { signal: request.signal });
        for await (const event of response) {
          if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
            record.answer += event.delta.text;
            send({ text: event.delta.text });
          }
        }
        const message = await response.finalMessage();
        if (message.stop_reason === 'max_tokens') {
          const note = '\n\n*(Answer shortened. Ask a more specific question for more detail.)*';
          record.answer += note;
          send({ text: note });
        }
        if (message.stop_reason === 'refusal') {
          const note = '\n\nI can’t answer that one. Please ask the board through Board Q&A.';
          record.answer += note;
          send({ text: note });
        }
        record.sources = sourcesFor(message, kb);
        send({ sources: record.sources });
        record.usage = {
          model: message.model,
          input_tokens: message.usage.input_tokens,
          cache_read_tokens: message.usage.cache_read_input_tokens,
          cache_write_tokens: message.usage.cache_creation_input_tokens,
          output_tokens: message.usage.output_tokens,
          cost_usd: costUsd(message.usage) + Number(record.usage.cost_usd ?? 0),
        };
        await supabase.rpc('log_event', {
          event_action: 'ask_answered',
          event_detail: {
            model: message.model,
            input_tokens: message.usage.input_tokens,
            cache_read_tokens: message.usage.cache_read_input_tokens,
            cache_write_tokens: message.usage.cache_creation_input_tokens,
            output_tokens: message.usage.output_tokens,
            stop_reason: message.stop_reason,
          },
        });
      } catch (error) {
        if (request.signal.aborted) record.error = 'stopped';
        else {
          console.error('Ask Lakeba failed', error instanceof Anthropic.APIError ? `${error.status} ${error.message}` : error);
          record.error = error instanceof Anthropic.APIError ? `api_${error.status}` : 'failed';
          send({ error: 'Ask Lakeba is unavailable right now. Please try again shortly.' });
        }
      } finally {
        const { data: stored } = await svc.from('ask_exchanges').insert({
          user_id: locals.user!.id,
          conversation_id: conversationId,
          turn: Math.ceil(turns.length / 2),
          question: turns.at(-1)!.content,
          answer: record.answer,
          sources: record.sources,
          declined: record.answer.trim() === DECLINE,
          error: record.error,
          ...record.usage,
        }).select('id').single();
        if (stored) send({ exchange: stored.id });
        try { controller.close(); } catch {}
      }
    },
  });

  return new Response(stream, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' } });
};
