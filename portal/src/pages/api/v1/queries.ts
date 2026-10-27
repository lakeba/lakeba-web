import { endpoint, json, page } from '../../../lib/api/core';

/** GET /api/v1/queries — Board Q&A questions, newest first, with their messages (not internal notes). Who asked needs "people.read". ?status. */
export const GET = endpoint('queries', { scope: 'inbox.view' }, async ({ svc, ctx, companyIds, can }) => {
  const p = page(ctx.url);
  let q = svc.from('queries').select('id, subject, status, created_at, updated_at, user_id, entities(code), query_messages(body, internal, created_at, author_id)', { count: 'exact' }).in('entity_id', companyIds).order('created_at', { ascending: false });
  const status = ctx.url.searchParams.get('status');
  if (status) q = q.eq('status', status);
  const { data, count } = await q.range(p.from, p.to);
  const ids = [...new Set((data ?? []).map((x) => x.user_id))];
  const { data: people } = can('people.read') && ids.length ? await svc.from('profiles').select('id, email, first_name, last_name').in('id', ids) : { data: [] };
  const who = new Map((people ?? []).map((x) => [x.id, x]));
  return json({ data: (data ?? []).map((x) => ({
    id: x.id, company: (x.entities as unknown as { code: string }).code, subject: x.subject, status: x.status, created_at: x.created_at, updated_at: x.updated_at,
    asked_by: can('people.read') ? (({ id: i, email, first_name, last_name }) => ({ id: i, email, first_name, last_name }))(who.get(x.user_id) ?? { id: x.user_id, email: null, first_name: null, last_name: null }) : { id: x.user_id },
    messages: ((x.query_messages ?? []) as { body: string; internal: boolean; created_at: string; author_id: string }[]).filter((m) => !m.internal).sort((a, b) => a.created_at.localeCompare(b.created_at)).map((m) => ({ from: m.author_id === x.user_id ? 'investor' : 'board', body: m.body, created_at: m.created_at })),
  })), total: count ?? 0, next_cursor: p.next(count ?? 0) });
});
