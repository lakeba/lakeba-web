import { ApiError, endpoint, isUuid, json, str } from '../../../../../../lib/api/core';
import { peopleIn } from '../../../../../../lib/api/data';

/**
 * PUT /api/v1/people/{id}/external-ids/{system} — { external_id }: the ID another system (e.g. your CRM, "crm")
 * uses for this investor, returned as external_ids on reads. DELETE removes it. Needs "investors.do".
 */
const handler = (method: 'PUT' | 'DELETE') => endpoint('people/{id}/external-ids/{system}', { scope: 'investors.do', write: true }, async ({ svc, ctx, company, companyIds, body, audit }) => {
  const id = ctx.params.id, system = (ctx.params.system ?? '').toLowerCase();
  if (!isUuid(id)) throw new ApiError(404, 'not_found', 'Not found.');
  if (!/^[a-z0-9_.-]{2,40}$/.test(system) || ['hubspot', 'xero'].includes(system)) throw new ApiError(422, 'bad_system', 'Name the system with 2–40 letters, digits, dots, dashes or underscores (hubspot and xero are kept by the portal).');
  await (async () => { const [p] = await peopleIn(svc, companyIds, { userIds: [id] }); if (!p) throw new ApiError(404, 'not_found', 'No such investor in this company.'); })();
  if (method === 'DELETE') {
    await svc.from('external_links').delete().eq('entity_id', company.id).eq('local_type', 'person').eq('local_id', id).eq('system', system);
    await audit('api_removed_external_id', { user_id: id, system });
    return json({ data: { deleted: true } });
  }
  const b = await body();
  const external = str(b, 'external_id', 200, true);
  await svc.from('external_links').upsert({ entity_id: company.id, local_type: 'person', local_id: id, system, external_id: external, synced_at: new Date().toISOString() });
  await audit('api_set_external_id', { user_id: id, system, external_id: external });
  return json({ data: { system, external_id: external } });
});
export const PUT = handler('PUT');
export const DELETE = handler('DELETE');
