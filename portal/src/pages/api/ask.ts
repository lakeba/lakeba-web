import type { APIRoute } from 'astro';
import Anthropic from '@anthropic-ai/sdk';
import { buildKnowledgeBase } from '../../lib/knowledge';
import { buildMessages, client, FULL_CONTEXT_LIMIT, MODEL, searchPassages, sourcesFor, SYSTEM, validateTurns, type ChatTurn } from '../../lib/ask';

const QUESTIONS_PER_HOUR = 30;

/**
 * Streams an Ask Lakeba answer as server-sent events:
 *   data: {"text": "..."}        pieces of the answer as they are written
 *   data: {"sources": [...]}     once, at the end
 *   data: {"error": "..."}       if something went wrong
 */
export const POST: APIRoute = async ({ request, locals, url }) => {
  if (request.headers.get('origin') !== url.origin) return new Response('Forbidden', { status: 403 });
  const supabase = locals.supabase;

  const { data: member } = await supabase.rpc('is_portal_member');
  if (!member) return Response.json({ error: 'Ask Lakeba is available once your account is linked to a shareholding.' }, { status: 403 });

  const body = await request.json().catch(() => null);
  const turns = body?.turns as ChatTurn[];
  const invalid = validateTurns(turns);
  if (invalid) return Response.json({ error: invalid }, { status: 400 });

  const since = new Date(Date.now() - 3600_000).toISOString();
  const { data: recent } = await supabase.rpc('my_recent_event_count', { event_action: 'ask_question', since });
  if (Number(recent ?? 0) >= QUESTIONS_PER_HOUR) return Response.json({ error: 'You have asked a lot of questions this hour. Please try again later.' }, { status: 429 });
  await supabase.rpc('log_event', { event_action: 'ask_question', event_detail: { length: turns.at(-1)!.content.length, turn: Math.ceil(turns.length / 2) } });

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (payload: object) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
      try {
        const kb = await buildKnowledgeBase();
        if (!client || kb.approxTokens > FULL_CONTEXT_LIMIT) {
          // AI answers off: point to the most relevant passages instead.
          const passages = await searchPassages(supabase, turns.at(-1)!.content);
          send({ text: passages.length ? 'AI answers are not switched on yet. These passages look most relevant:' : 'AI answers are not switched on yet, and no published document matches that question.' });
          send({ sources: passages.map((p) => ({ title: p.title, detail: p.page ? `page ${p.page}` : null, href: `/documents/${p.document_id}` })) });
          return;
        }
        const response = client.beta.messages.stream({
          model: MODEL,
          max_tokens: 16000,
          output_config: { effort: 'medium' },
          // Re-runs on a fallback model if a safety classifier declines.
          betas: ['server-side-fallback-2026-07-01'],
          fallbacks: 'default',
          system: SYSTEM,
          messages: buildMessages(kb, turns),
        }, { signal: request.signal });
        for await (const event of response) {
          if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') send({ text: event.delta.text });
        }
        const message = await response.finalMessage();
        if (message.stop_reason === 'refusal') send({ text: '\n\nI can’t answer that one. Please ask the board through Board Q&A.' });
        send({ sources: sourcesFor(message, kb) });
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
        if (!request.signal.aborted) {
          console.error('Ask Lakeba failed', error instanceof Anthropic.APIError ? `${error.status} ${error.message}` : error);
          send({ error: 'Ask Lakeba is unavailable right now. Please try again shortly.' });
        }
      } finally {
        try { controller.close(); } catch {}
      }
    },
  });

  return new Response(stream, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' } });
};
