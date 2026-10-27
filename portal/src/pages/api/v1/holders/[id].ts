import { endpoint, isUuid, json, ApiError } from '../../../../lib/api/core';
import { externalIds, holderIn, holderView } from '../../../../lib/api/data';

/** GET /api/v1/holders/{id} — one holder and its latest holdings. */
export const GET = endpoint('holders/{id}', { scope: 'investors.view' }, async ({ svc, ctx, companyIds }) => {
  const id = ctx.params.id;
  if (!isUuid(id)) throw new ApiError(404, 'not_found', 'No such holder.');
  const { classes, byHolder, holder } = await holderIn(svc, companyIds, id);
  const ext = await externalIds(svc, companyIds, 'holder', [id]);
  return json({ data: holderView(holder, byHolder.get(id) ?? [], classes, ext.get(id)) });
});
