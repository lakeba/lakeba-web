import { classesOf, endpoint, isUuid, json, page } from '../../../../lib/api/core';

/** GET /api/v1/holdings/history — every dated balance (newest first). ?holder_id, ?share_class, ?from, ?to (dates); limit, cursor. */
export const GET = endpoint('holdings/history', { scope: 'investors.view' }, async ({ svc, ctx, companyIds }) => {
  const p = page(ctx.url);
  const classes = await classesOf(svc, companyIds);
  const wantClass = ctx.url.searchParams.get('share_class')?.toUpperCase();
  const classIds = [...classes.values()].filter((c) => !wantClass || c.code.toUpperCase() === wantClass).map((c) => c.id);
  if (!classIds.length) return json({ data: [], total: 0, next_cursor: null });
  let q = svc.from('holdings').select('holder_id, share_class_id, shares, as_at', { count: 'exact' }).in('share_class_id', classIds).order('as_at', { ascending: false }).order('holder_id');
  const holder = ctx.url.searchParams.get('holder_id');
  if (isUuid(holder)) q = q.eq('holder_id', holder);
  const from = ctx.url.searchParams.get('from'), to = ctx.url.searchParams.get('to');
  if (from && /^\d{4}-\d{2}-\d{2}$/.test(from)) q = q.gte('as_at', from);
  if (to && /^\d{4}-\d{2}-\d{2}$/.test(to)) q = q.lte('as_at', to);
  const { data, count } = await q.range(p.from, p.to);
  return json({ data: (data ?? []).map((r) => ({ holder_id: r.holder_id, company: classes.get(r.share_class_id)!.company, share_class: classes.get(r.share_class_id)!.code, shares: Number(r.shares), as_at: r.as_at })), total: count ?? 0, next_cursor: p.next(count ?? 0) });
});
