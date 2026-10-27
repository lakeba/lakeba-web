import { ApiError, bool, endpoint, isUuid, json, page, str } from '../../../../lib/api/core';
import { brandOf } from '../../../../lib/brand';
import { addInvestor } from '../../../../lib/people';
import { externalIds, peopleIn } from '../../../../lib/api/data';

/**
 * GET /api/v1/people — investors (people who can see a holder in the company): name, email, phone, portal
 * status (not_invited, invited, active) and their holders. Needs "people.read". ?status; limit, cursor.
 */
export const GET = endpoint('people', { scope: 'people.read' }, async ({ svc, ctx, companyIds }) => {
  const p = page(ctx.url);
  const status = ctx.url.searchParams.get('status');
  const all = (await peopleIn(svc, companyIds)).filter((x) => !status || x.status === status);
  const slice = all.slice(p.from, p.to + 1);
  const ext = await externalIds(svc, companyIds, 'person', slice.map((x) => x.id));
  return json({ data: slice.map((x) => ({ ...x, external_ids: ext.get(x.id) ?? {} })), total: all.length, next_cursor: p.next(all.length) });
});

/**
 * POST /api/v1/people — adds an investor, linked to a holder of the company: { email, first_name, last_name,
 * holder_id (or holder_ref, the register reference), access: owner|viewer, invite: true|false }. Without
 * "invite", no email is sent (invite them later from the portal). Needs "investors.do".
 */
export const POST = endpoint('people', { scope: 'investors.do', write: true }, async ({ svc, ctx, company, companyIds, body, audit }) => {
  const b = await body();
  const email = str(b, 'email', 200, true).toLowerCase();
  let holderId = str(b, 'holder_id', 40);
  const ref = str(b, 'holder_ref', 40);
  if (!holderId && ref) holderId = (await svc.from('holders').select('id').eq('registry_ref', ref).maybeSingle()).data?.id ?? '';
  if (!isUuid(holderId)) throw new ApiError(422, 'missing_field', 'Give “holder_id” or “holder_ref” (the holder they invest through).', { field: 'holder_id' });
  const inCompany = await Promise.all(companyIds.map((id) => svc.rpc('holder_in_entity', { target_holder: holderId, target_entity: id }).then((r) => r.data)));
  if (!inCompany.some(Boolean)) throw new ApiError(422, 'holder_not_in_company', 'That holder has no shares in this company.');
  const { data: full } = await svc.from('entities').select('id, code, display_name, relationship, brand_color, logo_url, sender_name, reply_to, email_footer, slug').eq('id', company.id).single();
  const r = await addInvestor(svc, {
    email, firstName: str(b, 'first_name', 80), lastName: str(b, 'last_name', 80), holderId, access: b.access === 'viewer' ? 'viewer' : 'owner',
    invite: bool(b, 'invite'), origin: ctx.url.origin, brand: brandOf(full as never),
    log: (action, detail) => audit(action === 'admin_added_investor' ? 'api_added_person' : action, detail),
  });
  if ('error' in r) throw new ApiError(422, 'not_added', r.error);
  return json({ data: { id: r.userId, email, existing: r.existing, invited: r.invited } }, r.existing ? 200 : 201);
});
