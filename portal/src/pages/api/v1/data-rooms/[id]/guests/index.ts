import { ApiError, bool, endpoint, isUuid, json, str } from '../../../../../../lib/api/core';
import { inviteGuest } from '../../../../../../lib/data-rooms';
import { validEmail } from '../../../../../../lib/people';

/**
 * POST /api/v1/data-rooms/{id}/guests — invites a guest: { name, email, organisation, days (1–180, default 30),
 * send_email (default true) }. Returns their personal link (share it only with them). Needs "documents.do".
 */
export const POST = endpoint('data-rooms/{id}/guests', { scope: 'documents.do', write: true }, async ({ svc, ctx, companyIds, body, audit }) => {
  const id = ctx.params.id;
  const { data: room } = isUuid(id) ? await svc.from('data_rooms').select('id, entity_id, name, closed_at, entities(display_name, relationship, brand_color)').eq('id', id).in('entity_id', companyIds).maybeSingle() : { data: null };
  if (!room) throw new ApiError(404, 'not_found', 'No such data room in this company.');
  if (room.closed_at) throw new ApiError(409, 'room_closed', 'The room is closed: reopen it in the portal first.');
  const b = await body();
  const email = str(b, 'email', 200, true).toLowerCase();
  if (!validEmail(email)) throw new ApiError(422, 'bad_field', '“email” isn’t an email address.', { field: 'email' });
  const days = Math.min(180, Math.max(1, Number(b.days) || 30));
  const r = await inviteGuest(svc, { room, company: room.entities as never, guest: { name: str(b, 'name', 120, true), email, organisation: str(b, 'organisation', 120) }, days, origin: ctx.url.origin, invitedBy: null, send: bool(b, 'send_email', true), log: audit });
  if ('error' in r) throw new ApiError(422, 'not_added', r.error ?? 'Couldn’t invite them.');
  return json({ data: { id: r.guestId, link: r.link, expires_in_days: days, emailed: bool(b, 'send_email', true) } }, 201);
});
