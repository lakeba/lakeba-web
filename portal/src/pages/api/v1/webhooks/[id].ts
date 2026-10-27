import { ApiError, endpoint, isUuid, json } from '../../../../lib/api/core';

/** DELETE /api/v1/webhooks/{id} — unsubscribes (only subscriptions this key made). */
export const DELETE = endpoint('webhooks/{id}', { scope: 'any', write: true }, async ({ svc, ctx, key, audit }) => {
  const id = ctx.params.id;
  const { data } = isUuid(id) ? await svc.from('webhook_endpoints').delete().eq('id', id).eq('created_by_key', key.id).select('id, url') : { data: [] };
  if (!data?.length) throw new ApiError(404, 'not_found', 'No such subscription for this key.');
  await audit('api_unsubscribed_webhook', { endpoint_id: id, url: data[0].url });
  return json({ data: { id, deleted: true } });
});
