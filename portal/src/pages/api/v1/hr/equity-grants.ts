import { ApiError, endpoint, json, page } from '../../../../lib/api/core';

/**
 * GET /api/v1/hr/equity-grants — option and share grants under the company's equity plans, with vesting
 * terms and status; the holder's name with "people.read". ?status=draft|granted|cancelled|lapsed.
 */
export const GET = endpoint('hr/equity-grants', { scope: 'hr.view' }, async ({ svc, ctx, companyIds, can }) => {
  const p = page(ctx.url);
  let q = svc.from('equity_grants').select('id, person_id, holder_name, number, exercise_price, grant_date, vesting_start, vesting_months, cliff_months, frequency, expiry_date, status, vesting_stopped_on, accepted_at, created_at, updated_at, equity_plans(id, name, kind), entities(code)', { count: 'exact' }).in('entity_id', companyIds).order('grant_date', { ascending: false, nullsFirst: false });
  const status = ctx.url.searchParams.get('status');
  if (status) { if (!['draft', 'granted', 'cancelled', 'lapsed'].includes(status)) throw new ApiError(400, 'bad_status', 'status must be draft, granted, cancelled or lapsed.'); q = q.eq('status', status); }
  const { data, count } = await q.range(p.from, p.to);
  const personal = can('people.read');
  return json({ data: (data ?? []).map(({ entities, equity_plans, holder_name, ...g }) => ({ company: (entities as unknown as { code: string }).code, plan: equity_plans, ...g, number: Number(g.number), exercise_price: g.exercise_price == null ? null : Number(g.exercise_price), ...(personal ? { holder_name } : {}) })), total: count ?? 0, next_cursor: p.next(count ?? 0) });
});
