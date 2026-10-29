import { ApiError, endpoint, isDay, json, page } from '../../../../../lib/api/core';

/** GET /api/v1/legal/deadlines — the company's legal deadlines (annual review, solvency resolution, AGM…), soonest first. ?status=open|done|not_needed, ?from, ?to (YYYY-MM-DD). */
export const GET = endpoint('legal/deadlines', { scope: 'legal.view' }, async ({ svc, ctx, companyIds }) => {
  const p = page(ctx.url);
  const s = ctx.url.searchParams;
  let q = svc.from('legal_obligations').select('id, kind, title, detail, due_on, status, done_on, done_note, source_key, created_at, entities(code)', { count: 'exact' }).in('entity_id', companyIds).order('due_on');
  const status = s.get('status');
  if (status) { if (!['open', 'done', 'not_needed'].includes(status)) throw new ApiError(400, 'bad_status', 'status must be open, done or not_needed.'); q = q.eq('status', status); }
  for (const [k, op] of [['from', 'gte'], ['to', 'lte']] as const) {
    const v = s.get(k);
    if (v) { if (!isDay(v)) throw new ApiError(400, 'bad_date', `${k} must be YYYY-MM-DD.`); q = q[op]('due_on', v); }
  }
  const { data, count } = await q.range(p.from, p.to);
  return json({ data: (data ?? []).map(({ entities, source_key, ...o }) => ({ company: (entities as unknown as { code: string }).code, ...o, added_by: source_key ? 'portal' : 'person' })), total: count ?? 0, next_cursor: p.next(count ?? 0) });
});
