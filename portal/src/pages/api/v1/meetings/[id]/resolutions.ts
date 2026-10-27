import { ApiError, endpoint, isUuid, json, str } from '../../../../../lib/api/core';

/** POST /api/v1/meetings/{id}/resolutions — { number, title, description, kind (ordinary|special) }. Not once proxy voting is open. Needs "meetings.do". */
export const POST = endpoint('meetings/{id}/resolutions', { scope: 'meetings.do', write: true }, async ({ svc, ctx, companyIds, body, audit }) => {
  const id = ctx.params.id;
  const { data: m } = isUuid(id) ? await svc.from('meetings').select('id, status').eq('id', id).in('entity_id', companyIds).maybeSingle() : { data: null };
  if (!m) throw new ApiError(404, 'not_found', 'No such meeting in this company.');
  if (m.status !== 'upcoming') throw new ApiError(409, 'meeting_open', 'Proxy voting has opened: change resolutions in the portal.');
  const b = await body();
  const number = Number(b.number);
  if (!Number.isInteger(number) || number < 1) throw new ApiError(422, 'bad_field', '“number” must be 1 or more.', { field: 'number' });
  const { data, error } = await svc.from('resolutions').insert({ meeting_id: id, number, title: str(b, 'title', 300, true), description: str(b, 'description', 5000), kind: b.kind === 'special' ? 'special' : 'ordinary' }).select('id').single();
  if (error) throw new ApiError(error.code === '23505' ? 409 : 422, error.code === '23505' ? 'number_taken' : 'not_added', error.code === '23505' ? 'That resolution number is already used.' : error.message);
  await audit('admin_added_resolution', { meeting_id: id, resolution_id: data!.id });
  return json({ data: { id: data!.id, number } }, 201);
});
