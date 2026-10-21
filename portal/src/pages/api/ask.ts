import type { APIRoute } from 'astro';
import Anthropic from '@anthropic-ai/sdk';
import { buildKnowledgeBase } from '../../lib/knowledge';
import { serviceClient } from '../../lib/admin';
import { buildMessages, client, costUsd, DECLINE, FULL_CONTEXT_LIMIT, loadHouseRules, MODEL, searchPassages, sourcesFor, systemPrompt, validateTurns, type ChatTurn, type SourceRef } from '../../lib/ask';

const QUESTIONS_PER_HOUR = 30;

/**
 * Streams an Ask Lakeba answer as server-sent events:
 *   data: {"text": "..."}        pieces of the answer as they are written
 *   data: {"sources": [...]}     once, at the end
 *   data: {"exchange": "<id>"}   the stored record, so the answer can be rated
 *   data: {"error": "..."}       if something went wrong
 * Every exchange is stored for admin review (Admin → Ask review).
 */
export const POST: APIRoute = async ({ request, locals, url }) => {
  if (request.headers.get('origin') !== url.origin) return new Response('Forbidden', { status: 403 });
  const supabase = locals.supabase;

  const { data: member } = await supabase.rpc('is_portal_member');
  if (!member) return Response.json({ error: 'Ask Lakeba is available once your account is linked to a shareholding.' }, { status: 403 });

  const body = await request.json().catch(() => null);
  const turns = body?.turns as ChatTurn[];
  const conversationId = /^[0-9a-f-]{36}$/.test(body?.conversationId ?? '') ? body.conversationId : crypto.randomUUID();
  const invalid = validateTurns(turns);
  if (invalid) return Response.json({ error: invalid }, { status: 400 });

  const since = new Date(Date.now() - 3600_000).toISOString();
  const { data: recent } = await supabase.rpc('my_recent_event_count', { event_action: 'ask_question', since });
  if (Number(recent ?? 0) >= QUESTIONS_PER_HOUR) return Response.json({ error: 'You have asked a lot of questions this hour. Please try again later.' }, { status: 429 });
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
        const [kb, houseRules] = await Promise.all([buildKnowledgeBase(), loadHouseRules(serviceClient())]);
        if (!client || kb.approxTokens > FULL_CONTEXT_LIMIT) {
          // AI answers off: point to the most relevant passages instead.
          const passages = await searchPassages(supabase, turns.at(-1)!.content);
          record.answer = passages.length ? 'AI answers are not switched on yet. These passages look most relevant:' : 'AI answers are not switched on yet, and no published document matches that question.';
          record.sources = passages.map((p) => ({ title: p.title, detail: p.page ? `page ${p.page}` : null, href: `/documents/${p.document_id}` }));
          record.error = 'ai_off';
          send({ text: record.answer });
          send({ sources: record.sources });
          return;
        }
        const response = client.beta.messages.stream({
          model: MODEL,
          max_tokens: 16000,
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
          cost_usd: costUsd(message.usage),
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
        const { data: stored } = await serviceClient().from('ask_exchanges').insert({
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
