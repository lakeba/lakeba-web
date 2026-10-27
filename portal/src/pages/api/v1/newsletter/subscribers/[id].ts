import { ApiError, endpoint, isUuid, json } from '../../../../../lib/api/core';
import { unsubscribe } from '../../../../../lib/integrations/actions';

/** DELETE /api/v1/newsletter/subscribers/{id} — unsubscribes them (kept as unsubscribed). Needs "newsletters.do". */
export const DELETE = endpoint('newsletter/subscribers/{id}', { scope: 'newsletters.do', write: true }, async ({ svc, ctx, company, audit }) => {
  const id = ctx.params.id;
  const r = isUuid(id) ? await unsubscribe(svc, company as never, id) : null;
  if (!r) throw new ApiError(404, 'not_found', 'No such subscriber on this company’s list.');
  await audit('newsletter_unsubscribed', { subscriber_id: id, email: r.email });
  return json({ data: { id, status: 'unsubscribed' } });
});
