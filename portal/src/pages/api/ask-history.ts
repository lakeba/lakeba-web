import type { APIRoute } from 'astro';
import { serviceClient } from '../../lib/admin';
import { running } from '../../lib/ask-running';

/**
 * A person's Ask conversations for one company (the Ask page), kept for 12 months:
 *   GET ?company=CODE&list=1                 their conversations, newest first (title = first question)
 *   GET ?company=CODE&conversation=<id>      that conversation, to read and continue
 *   GET ?company=CODE                        their latest conversation
 *   DELETE ?company=CODE&conversation=<id>   removes it from their list (Ask review keeps the record)
 * A conversation returns its finished turns and, when an answer is still being
 * written, how far it has got.
 */
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

export const GET: APIRoute = async ({ url, locals }) => {
  const company = locals.companies.find((c) => c.code === url.searchParams.get('company')) ?? null;
  if (!company || !locals.user) return json({ error: 'Not found' }, 404);
  const me = locals.user.id;
  const svc = serviceClient();
  const mine = () => svc.from('ask_exchanges').select('conversation_id, question, created_at').eq('user_id', me).eq('entity_id', company.id).is('hidden_at', null);

  if (url.searchParams.get('list')) {
    const { data } = await mine().order('created_at', { ascending: false }).limit(2000);
    const list = new Map<string, { id: string; title: string; updatedAt: string; questions: number }>();
    // Newest first: the first row seen gives the latest time; the last one seen (the earliest) gives the title.
    for (const r of data ?? []) {
      const c = list.get(r.conversation_id);
      if (c) { c.title = r.question; c.questions++; } else list.set(r.conversation_id, { id: r.conversation_id, title: r.question, updatedAt: r.created_at, questions: 1 });
    }
    for (const [id, r] of running) if (r.userId === me && r.companyCode === company.code && !list.has(id)) list.set(id, { id, title: r.question, updatedAt: new Date().toISOString(), questions: 1 });
    return json({ conversations: [...list.values()].slice(0, 100) });
  }

  let conversation = url.searchParams.get('conversation') ?? '';
  if (!/^[0-9a-f-]{36}$/.test(conversation)) {
    const live = [...running.entries()].find(([, r]) => r.userId === me && r.companyCode === company.code);
    const { data: last } = await mine().order('created_at', { ascending: false }).limit(1).maybeSingle();
    conversation = live?.[0] ?? last?.conversation_id ?? '';
    if (!conversation) return json({ conversationId: null, turns: [], pending: null });
  }
  const { data: rows } = await svc.from('ask_exchanges').select('id, question, answer, sources, feedback, error').eq('user_id', me).eq('conversation_id', conversation).is('hidden_at', null).order('created_at');
  const turns = (rows ?? []).flatMap((r) => [
    { role: 'user', content: r.question },
    { role: 'assistant', content: r.answer || 'Stopped.', sources: r.sources ?? [], exchange: r.id, rating: r.feedback ?? undefined },
  ]);
  const live = running.get(conversation);
  const pending = live && live.userId === me ? { question: live.question, answer: live.answer } : null;
  return json({ conversationId: conversation, turns, pending });
};

export const DELETE: APIRoute = async ({ url, locals, request }) => {
  if (request.headers.get('origin') !== url.origin || !locals.user) return json({ error: 'Forbidden' }, 403);
  const company = locals.companies.find((c) => c.code === url.searchParams.get('company')) ?? null;
  const conversation = url.searchParams.get('conversation') ?? '';
  if (!company || !/^[0-9a-f-]{36}$/.test(conversation)) return json({ error: 'Not found' }, 404);
  const live = running.get(conversation);
  if (live?.userId === locals.user.id) live.stop.abort();
  await serviceClient().from('ask_exchanges').update({ hidden_at: new Date().toISOString() }).eq('user_id', locals.user.id).eq('conversation_id', conversation);
  await locals.supabase.rpc('log_event', { event_action: 'ask_conversation_deleted', event_detail: { company: company.code } });
  return new Response(null, { status: 204 });
};
