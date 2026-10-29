import { ApiError, endpoint, isDay, json, page } from '../../../../lib/api/core';

/**
 * GET /api/v1/legal/contracts — contracts read by Lakeba AI and checked by a person: parties, key dates,
 * renewal and notice, value and the clauses that matter. ?status=draft|active|ended, ?ends_before=YYYY-MM-DD.
 */
export const GET = endpoint('legal/contracts', { scope: 'legal.view' }, async ({ svc, ctx, companyIds }) => {
  const p = page(ctx.url);
  const s = ctx.url.searchParams;
  let q = svc.from('contracts').select('id, title, counterparty, contract_type, status, signed_on, starts_on, ends_on, auto_renews, renewal_term, notice_days, value, governing_law, change_of_control, assignment, exclusivity, liability_cap, termination, summary, checked_at, created_at, updated_at, entities(code)', { count: 'exact' })
    .in('entity_id', companyIds).order('ends_on', { ascending: true, nullsFirst: false });
  const status = s.get('status');
  if (status) { if (!['draft', 'active', 'ended'].includes(status)) throw new ApiError(400, 'bad_status', 'status must be draft, active or ended.'); q = q.eq('status', status); }
  const before = s.get('ends_before');
  if (before) { if (!isDay(before)) throw new ApiError(400, 'bad_date', 'ends_before must be YYYY-MM-DD.'); q = q.lte('ends_on', before); }
  const { data, count } = await q.range(p.from, p.to);
  return json({ data: (data ?? []).map(({ entities, checked_at, ...c }) => ({ company: (entities as unknown as { code: string }).code, ...c, checked: Boolean(checked_at) })), total: count ?? 0, next_cursor: p.next(count ?? 0) });
});
