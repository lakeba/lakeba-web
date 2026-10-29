import { ApiError, endpoint, json, page } from '../../../../lib/api/core';

/**
 * GET /api/v1/hr/people — the company's people in HR: role, team, employment type, dates and status;
 * names and emails with "people.read". Private details stay in the portal. ?status=onboarding|active|offboarding|left.
 */
export const GET = endpoint('hr/people', { scope: 'hr.view' }, async ({ svc, ctx, companyIds, can }) => {
  const p = page(ctx.url);
  let q = svc.from('people').select('id, full_name, email, job_title, team, employment_type, manager_id, location, start_date, end_date, status, created_at, updated_at, entities(code)', { count: 'exact' }).in('entity_id', companyIds).order('start_date', { ascending: false, nullsFirst: false });
  const status = ctx.url.searchParams.get('status');
  if (status) { if (!['onboarding', 'active', 'offboarding', 'left'].includes(status)) throw new ApiError(400, 'bad_status', 'status must be onboarding, active, offboarding or left.'); q = q.eq('status', status); }
  const { data, count } = await q.range(p.from, p.to);
  const personal = can('people.read');
  return json({ data: (data ?? []).map(({ entities, full_name, email, ...x }) => ({ company: (entities as unknown as { code: string }).code, ...x, ...(personal ? { full_name, email } : {}) })), total: count ?? 0, next_cursor: p.next(count ?? 0) });
});
