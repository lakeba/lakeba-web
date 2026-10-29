import { endpoint, json, page } from '../../../../lib/api/core';
import { todayIn } from '../../../../lib/reporting';

/**
 * GET /api/v1/legal/officers — the officers register: position and dates; names and emails with
 * "people.read". Private details (address, date of birth) never leave the portal. ?current=true: only
 * those in office today.
 */
export const GET = endpoint('legal/officers', { scope: 'legal.view' }, async ({ svc, ctx, companyIds, can }) => {
  const p = page(ctx.url);
  let q = svc.from('company_officers').select('id, full_name, email, position, appointed_on, ceased_on, consent_on, updated_at, entities(code)', { count: 'exact' }).in('entity_id', companyIds).order('appointed_on', { ascending: true, nullsFirst: true });
  if (ctx.url.searchParams.get('current') === 'true') q = q.or(`ceased_on.is.null,ceased_on.gt.${todayIn()}`);
  const { data, count } = await q.range(p.from, p.to);
  const personal = can('people.read');
  return json({ data: (data ?? []).map(({ entities, full_name, email, ...o }) => ({ company: (entities as unknown as { code: string }).code, ...o, ...(personal ? { full_name, email } : {}) })), total: count ?? 0, next_cursor: p.next(count ?? 0) });
});
