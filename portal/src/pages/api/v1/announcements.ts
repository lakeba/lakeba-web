import { endpoint, json, page } from '../../../lib/api/core';

/** GET /api/v1/announcements — dashboard announcements, newest first. ?current=true for those showing now. */
export const GET = endpoint('announcements', { scope: 'news.view' }, async ({ svc, ctx, companyIds }) => {
  const p = page(ctx.url);
  let q = svc.from('announcements').select('id, title, body, link_url, link_label, tone, starts_at, ends_at, created_at, entities(code)', { count: 'exact' }).in('entity_id', companyIds).order('created_at', { ascending: false });
  if (ctx.url.searchParams.get('current') === 'true') { const now = new Date().toISOString(); q = q.lte('starts_at', now).or(`ends_at.is.null,ends_at.gt.${now}`); }
  const { data, count } = await q.range(p.from, p.to);
  return json({ data: (data ?? []).map(({ entities, ...a }) => ({ company: (entities as unknown as { code: string }).code, ...a })), total: count ?? 0, next_cursor: p.next(count ?? 0) });
});
