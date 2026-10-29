import type { APIRoute } from 'astro';
import { serviceClient } from '../../../../../lib/admin';
import { answerHtml, askBoard } from '../../../../../lib/board-ask';
import { clean, meetingFacts, splitAnswer, spokenSoFar } from '../../../../../lib/lex';
import { observerMeeting } from '../../../../../lib/observer';

/**
 * A question put to Lex at the table (JSON {question, how, offset_ms}),
 * answered as server-sent events:
 *   data: {"step": "…"}              what Lex is looking at
 *   data: {"say": "…"}               a sentence to say aloud, as soon as it is written
 *   data: {"done": {"spoken", "html", "sources"}}
 *   data: {"error": "…"}
 * Lex uses the meeting company's records (the whole group for Lakeba's own board).
 */
export const POST: APIRoute = async ({ request, params, locals, url }) => {
  if (request.headers.get('origin') !== url.origin) return new Response('Forbidden', { status: 403 });
  const svc = serviceClient();
  const m = await observerMeeting(svc, locals.access, params.id ?? '');
  if (!m) return Response.json({ error: 'Not found.' }, { status: 404 });
  const b = await request.json().catch(() => ({})) as { question?: unknown; how?: unknown; offset_ms?: unknown; context?: unknown };
  // During a presentation: the slide on screen, so "this" and "that figure" make sense.
  const context = typeof b.context === 'string' ? b.context.slice(0, 3000) : '';
  const question = typeof b.question === 'string' ? b.question.trim().slice(0, 2000) : '';
  if (question.length < 3) return Response.json({ error: 'Ask a question.' }, { status: 400 });
  const how = ['voice', 'tap', 'typed'].includes(String(b.how)) ? String(b.how) : 'typed';
  const { data: company } = await svc.from('entities').select('id, display_name, legal_name, relationship').eq('id', m.entity_id).single();
  const { data: earlier } = await svc.from('board_meeting_assistant').select('question, answer').eq('meeting_id', m.id).eq('status', 'done').order('created_at', { ascending: false }).limit(3);
  const { data: row } = await svc.from('board_meeting_assistant').insert({ meeting_id: m.id, asked_by: locals.user!.id, how, offset_ms: typeof b.offset_ms === 'number' && Number.isFinite(b.offset_ms) ? Math.max(0, Math.round(b.offset_ms)) : null, question }).select('id').single().throwOnError();
  await locals.supabase.rpc('log_event', { event_action: 'admin_asked_lex', event_detail: { entity_id: m.entity_id, meeting_id: m.id, how, question: question.slice(0, 200) } });

  const central = locals.site?.central ?? url.origin;
  const encoder = new TextEncoder();
  const stop = new AbortController();
  request.signal.addEventListener('abort', () => stop.abort());
  const stream = new ReadableStream({
    async start(controller) {
      const send = (o: unknown) => { try { controller.enqueue(encoder.encode(`data: ${JSON.stringify(o)}\n\n`)); } catch { /* the page went away */ } };
      // Each sentence of the spoken part goes out the moment it is written, so Lex starts talking at
      // the first one. At most three sentences, in case the answer has no spoken part.
      let draft = '', sent = 0, sentences = 0, spokenDone = false;
      try {
        const facts = await meetingFacts(svc, locals.access, central, locals.user!.id, m).catch((e) => { console.error('lex facts', e); return undefined; });
        const r = await askBoard(svc, locals.access, central, context ? `${context}\n\nQuestion: ${question}` : question, (earlier ?? []).reverse().map((e) => ({ question: e.question, answer: e.answer })), {
          step: (s) => send({ step: s.label }),
          reset: () => { draft = ''; sent = 0; },
          text: (d) => {
            draft += d;
            if (spokenDone) return;
            const { upto, head, finished } = spokenSoFar(draft);
            if (upto > sent) {
              const piece = clean(head.slice(sent, upto));
              sent = upto;
              if (piece) { send({ say: piece }); sentences += piece.match(/[.!?]+(\s|$)/g)?.length ?? 1; }
            }
            if (finished || sentences >= 3) spokenDone = true;
          },
        }, stop.signal, { only: company?.relationship === 'group' ? undefined : [m.entity_id], voice: { meeting: m.title, company: company?.legal_name ?? company?.display_name ?? '', facts } });
        const { spoken, detail } = splitAnswer(r.answer);
        await svc.from('board_meeting_assistant').update({ spoken, answer: detail, sources: r.sources, steps: r.steps, cost_usd: r.costUsd, status: 'done' }).eq('id', row!.id);
        send({ done: { id: row!.id, spoken, html: answerHtml(detail, r.sources), sources: r.sources } });
      } catch (e) {
        const stopped = stop.signal.aborted;
        await svc.from('board_meeting_assistant').update({ status: stopped ? 'stopped' : 'failed', error: (e as Error).message.slice(0, 500) }).eq('id', row!.id);
        if (!stopped) console.error('lex', e);
        send({ error: stopped ? 'Stopped.' : `Lex couldn’t answer: ${(e as Error).message}` });
      }
      try { controller.close(); } catch { /* closed already */ }
    },
    cancel() { stop.abort(); },
  });
  return new Response(stream, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', 'X-Accel-Buffering': 'no' } });
};
