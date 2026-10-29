import type { APIRoute } from 'astro';
import { serviceClient } from '../../../lib/admin';
import { answerHtml, askBoard, BOARD_MODEL } from '../../../lib/board-ask';

/**
 * Answers a Board Ask question as server-sent events:
 *   data: {"conversation": "<id>", "message": "<id>"}   first
 *   data: {"step": "Searching the law library: …"}      each thing it looks at
 *   data: {"text": "..."}                               the answer as it is written
 *   data: {"reset": true}                               text so far was a draft; start again
 *   data: {"done": {"html": "...", "sources": [...], "cost": 0.12}}
 *   data: {"error": "..."}
 * Leaving the page stops the answer (and what it costs).
 */
export const POST: APIRoute = async ({ request, locals, url }) => {
  if (request.headers.get('origin') !== url.origin) return new Response('Forbidden', { status: 403 });
  const body = await request.json().catch(() => null) as { question?: unknown; conversation?: unknown } | null;
  const question = typeof body?.question === 'string' ? body.question.trim().slice(0, 4000) : '';
  if (question.length < 3) return Response.json({ error: 'Ask a question.' }, { status: 400 });
  const svc = serviceClient();
  const userId = locals.user!.id;

  // The conversation: this person's own, or a new one.
  let conversationId = typeof body?.conversation === 'string' && /^[0-9a-f-]{36}$/.test(body.conversation) ? body.conversation : null;
  if (conversationId) {
    const { data } = await svc.from('board_ask_conversations').select('id').eq('id', conversationId).eq('user_id', userId).maybeSingle();
    if (!data) conversationId = null;
  }
  if (!conversationId) {
    const { data } = await svc.from('board_ask_conversations').insert({ user_id: userId, title: question.slice(0, 120) }).select('id').single().throwOnError();
    conversationId = data!.id as string;
  }
  const { data: earlier } = await svc.from('board_ask_messages').select('question, answer').eq('conversation_id', conversationId).eq('status', 'done').order('created_at').limit(20);
  const { data: row } = await svc.from('board_ask_messages').insert({ conversation_id: conversationId, user_id: userId, question, model: BOARD_MODEL }).select('id').single().throwOnError();
  const messageId = row!.id as string;
  await svc.from('board_ask_conversations').update({ updated_at: new Date().toISOString() }).eq('id', conversationId);
  await locals.supabase.rpc('log_event', { event_action: 'admin_asked_board_ask', event_detail: { question: question.slice(0, 200), message_id: messageId } });

  const central = locals.site?.central ?? url.origin;
  const encoder = new TextEncoder();
  const stop = new AbortController();
  request.signal.addEventListener('abort', () => stop.abort());
  const stream = new ReadableStream({
    async start(controller) {
      const send = (o: unknown) => { try { controller.enqueue(encoder.encode(`data: ${JSON.stringify(o)}\n\n`)); } catch { /* the page went away */ } };
      send({ conversation: conversationId, message: messageId });
      try {
        const r = await askBoard(svc, locals.access, central, question, earlier ?? [], {
          step: (s) => send({ step: s.label }), text: (d) => send({ text: d }), reset: () => send({ reset: true }),
        }, stop.signal);
        await svc.from('board_ask_messages').update({ answer: r.answer, sources: r.sources, steps: r.steps, scope: r.scope, cost_usd: r.costUsd, status: 'done' }).eq('id', messageId);
        send({ done: { html: answerHtml(r.answer, r.sources), sources: r.sources, cost: r.costUsd } });
      } catch (e) {
        const stopped = stop.signal.aborted;
        const message = stopped ? 'Stopped.' : (e as Error).message || 'Something went wrong.';
        await svc.from('board_ask_messages').update({ status: stopped ? 'stopped' : 'failed', error: message.slice(0, 500) }).eq('id', messageId);
        if (!stopped) console.error('board ask', e);
        send({ error: stopped ? message : `Board Ask couldn’t answer: ${message}` });
      }
      try { controller.close(); } catch { /* closed already */ }
    },
    cancel() { stop.abort(); },
  });
  return new Response(stream, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', 'X-Accel-Buffering': 'no' } });
};
