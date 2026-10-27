import { ApiError, endpoint, isUuid, json } from '../../../../lib/api/core';
import { externalIds, peopleIn } from '../../../../lib/api/data';
import { updatePerson } from '../../../../lib/integrations/actions';
import { str } from '../../../../lib/api/core';

/** GET /api/v1/people/{id} — one investor. Needs "people.read". */
export const GET = endpoint('people/{id}', { scope: 'people.read' }, async ({ svc, ctx, companyIds }) => {
  const id = ctx.params.id;
  const [person] = isUuid(id) ? await peopleIn(svc, companyIds, { userIds: [id] }) : [];
  if (!person) throw new ApiError(404, 'not_found', 'No such investor in this company.');
  const ext = await externalIds(svc, companyIds, 'person', [id!]);
  return json({ data: { ...person, external_ids: ext.get(id!) ?? {} } });
});

/**
 * PATCH /api/v1/people/{id} — { first_name, last_name, phone }. Only for investors of this company who aren't
 * investors in another company too (409 otherwise: change them in the portal). Needs "investors.do".
 */
export const PATCH = endpoint('people/{id}', { scope: 'investors.do', write: true }, async ({ svc, ctx, companyIds, body, audit }) => {
  const id = ctx.params.id;
  if (!isUuid(id)) throw new ApiError(404, 'not_found', 'No such investor.');
  const b = await body();
  const next = Object.fromEntries((['first_name', 'last_name', 'phone'] as const).filter((k) => k in b).map((k) => [k, str(b, k, 80)]));
  const r = await updatePerson(svc, companyIds, id, next);
  if ('error' in r) {
    if (r.error === 'not_found') throw new ApiError(404, 'not_found', 'No such investor in this company.');
    if (r.error === 'shared') throw new ApiError(409, 'shared_person', 'This person is also an investor in another company: change their details in the portal.');
    throw new ApiError(422, 'nothing_to_change', 'Send first_name, last_name or phone.');
  }
  await audit('api_updated_person', { user_id: id, from: r.before, to: r.after });
  const [person] = await peopleIn(svc, companyIds, { userIds: [id] });
  return json({ data: person });
});
