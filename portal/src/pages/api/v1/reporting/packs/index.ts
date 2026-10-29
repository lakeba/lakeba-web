import { ApiError, endpoint, json, page } from '../../../../../lib/api/core';
import { ensurePacks } from '../../../../../lib/reporting';

/**
 * GET /api/v1/reporting/packs — the company's reporting packs for Lakeba (profit and loss and balance
 * sheet per period), newest period first, with their figures. ?status=open|submitted|returned|accepted.
 */
export const GET = endpoint('reporting/packs', { scope: 'reporting.view' }, async ({ svc, ctx, companyIds }) => {
  // The periods due so far exist as packs, as they do when the reporting page opens.
  await ensurePacks(svc, companyIds).catch(() => undefined);
  const p = page(ctx.url);
  let q = svc.from('reporting_packs').select('id, period_end, cadence, due_on, status, source, figures, note, submitted_at, reviewed_at, updated_at, entities(code)', { count: 'exact' }).in('entity_id', companyIds).order('period_end', { ascending: false });
  const status = ctx.url.searchParams.get('status');
  if (status) { if (!['open', 'submitted', 'returned', 'accepted'].includes(status)) throw new ApiError(400, 'bad_status', 'status must be open, submitted, returned or accepted.'); q = q.eq('status', status); }
  const { data, count } = await q.range(p.from, p.to);
  return json({ data: (data ?? []).map(({ entities, ...r }) => ({ company: (entities as unknown as { code: string }).code, ...r })), total: count ?? 0, next_cursor: p.next(count ?? 0) });
});
