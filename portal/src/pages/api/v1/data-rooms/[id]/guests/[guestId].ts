import { ApiError, endpoint, isUuid, json } from '../../../../../../lib/api/core';

/** DELETE /api/v1/data-rooms/{id}/guests/{guestId} — revokes a guest: their link stops working at once. Needs "documents.do". */
export const DELETE = endpoint('data-rooms/{id}/guests/{guestId}', { scope: 'documents.do', write: true }, async ({ svc, ctx, companyIds, audit }) => {
  const { id, guestId } = ctx.params;
  if (!isUuid(id) || !isUuid(guestId)) throw new ApiError(404, 'not_found', 'Not found.');
  const { data: room } = await svc.from('data_rooms').select('id').eq('id', id).in('entity_id', companyIds).maybeSingle();
  if (!room) throw new ApiError(404, 'not_found', 'No such data room in this company.');
  const { data } = await svc.from('data_room_guests').update({ revoked_at: new Date().toISOString() }).eq('id', guestId).eq('room_id', id).eq('is_test', false).is('revoked_at', null).select('id, email');
  if (!data?.length) throw new ApiError(404, 'not_found', 'No such guest (or already revoked).');
  await audit('data_room_guest_revoked', { room_id: id, guest_id: guestId, email: data[0].email });
  return json({ data: { id: guestId, revoked: true } });
});
