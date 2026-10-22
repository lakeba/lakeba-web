import type { APIRoute } from 'astro';
import Anthropic from '@anthropic-ai/sdk';
import { buildKnowledgeBase } from '../../lib/knowledge';
import { serviceClient } from '../../lib/admin';
import { askName, buildMessages, client, costUsd, declineFor, FULL_CONTEXT_LIMIT, isDecline, loadHouseRules, MODEL, searchPassages, sourcesFor, systemPrompt, validateTurns, type ChatTurn, type SourceRef } from '../../lib/ask';
import { checkAskAllowed, loadLimits, precheckOnTopic, PRECHECK_MODEL } from '../../lib/ask-limits';
import { loadRetrieval, retrieveKnowledgeBase, standaloneQuery } from '../../lib/retrieval';

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

  const body = await request.json().catch(() => null);
  // Each company has its own assistant, answering from that company's material only.
  // The company must be one this person belongs to (membership comes from the database).
  const company = locals.companies.find((c) => c.code === body?.company) ?? null;
  if (!company) return Response.json({ error: 'Ask is available to shareholders of the company you are viewing.' }, { status: 403 });
  const DECLINE = declineFor(company);
  const turns = body?.turns as ChatTurn[];
  const conversationId = /^[0-9a-f-]{36}$/.test(body?.conversationId ?? '') ? body.conversationId : crypto.randomUUID();
  const invalid = validateTurns(turns);
  if (invalid) return Response.json({ error: invalid }, { status: 400 });

  const svc = serviceClient();
  const [limits, retrieval] = await Promise.all([loadLimits(svc), loadRetrieval(svc)]);
  // Full knowledge base, or only the best-matching passages (Admin → Ask knowledge).
  // Admins may pick the mode per question, for comparing the two.
  const admin = locals.profile?.role === 'admin' && locals.user?.aal === 'aal2';
  let mode: 'full' | 'retrieval' = admin && ['full', 'retrieval'].includes(body?.mode) ? body.mode : retrieval.enabled ? 'retrieval' : 'full';
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
      const record: { answer: string; sources: SourceRef[]; error: string | null; usage: Record<string, unknown>; query: string | null } = { answer: '', sources: [], error: null, usage: {}, query: null };
      try {
        if (!client || gate.budgetReached) {
          // AI answers off or today's budget used: point to the most relevant passages instead.
          const passages = await searchPassages(supabase, turns.at(-1)!.content, company);
          const why = !client ? 'AI answers are not switched on yet.' : `${askName(company)} has reached its daily limit for AI answers; they resume at midnight (Sydney time).`;
          record.answer = passages.length ? `${why} These passages look most relevant:` : `${why} No published document matches that question.`;
          record.sources = passages.map((p) => ({ title: p.title, detail: p.page ? `page ${p.page}` : null, href: `/documents/${p.document_id}` }));
          record.error = !client ? 'ai_off' : 'budget';
          send({ text: record.answer });
          send({ sources: record.sources });
          return;
        }
        // Cheap pre-check: clearly off-topic questions are declined without sending the knowledge base.
        if (limits.precheck) {
          const check = await precheckOnTopic(turns, company);
          if (!check.onTopic) {
            record.answer = DECLINE;
            record.usage = { model: PRECHECK_MODEL, cost_usd: check.costUsd };
            send({ text: DECLINE });
            send({ sources: [] });
            return;
          }
          record.usage = { cost_usd: check.costUsd };
        }
        let kb;
        const houseRules = await loadHouseRules(svc, company);
        if (mode === 'retrieval') {
          try {
            const rewritten = await standaloneQuery(turns);
            record.query = rewritten.query;
            record.usage = { cost_usd: Number(record.usage.cost_usd ?? 0) + rewritten.costUsd };
            kb = await retrieveKnowledgeBase(company, rewritten.query, retrieval.passages);
          } catch (error) {
            // Never leave a shareholder without an answer: fall back to the full documents.
            console.error('Ask retrieval failed; answering from the full documents', error);
            mode = 'full';
          }
        }
        kb ??= await buildKnowledgeBase(company);
        if (kb.approxTokens > FULL_CONTEXT_LIMIT) throw new Error('Knowledge base too large to send in full');
        const response = client.beta.messages.stream({
          model: MODEL,
          max_tokens: limits.maxAnswerTokens,
          output_config: { effort: 'medium' },
          // Re-runs on a fallback model if a safety classifier declines.
          betas: ['server-side-fallback-2026-07-01'],
          fallbacks: 'default',
          system: systemPrompt(houseRules, company),
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
          send({ error: `${askName(company)} is unavailable right now. Please try again shortly.` });
        }
      } finally {
        const { data: stored } = await svc.from('ask_exchanges').insert({
          user_id: locals.user!.id,
          entity_id: company.id,
          mode,
          retrieval_query: record.query,
          conversation_id: conversationId,
          turn: Math.ceil(turns.length / 2),
          question: turns.at(-1)!.content,
          answer: record.answer,
          sources: record.sources,
          declined: isDecline(record.answer),
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
