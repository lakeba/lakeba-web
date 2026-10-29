import { ApiError, endpoint, isDay, isUuid, json, str } from '../../../../../lib/api/core';
import { todayIn } from '../../../../../lib/reporting';

/**
 * PATCH /api/v1/legal/deadlines/{id} — { status: done | not_needed | open, done_on (YYYY-MM-DD, default
 * today), note } marks a deadline done (or not needed, which needs a note), or opens it again. Proof files
 * are added in the portal. Needs "legal.do".
 */
export const PATCH = endpoint('legal/deadlines/{id}', { scope: 'legal.do', write: true }, async ({ svc, ctx, companyIds, body, audit }) => {
  const id = ctx.params.id;
  const { data: o } = isUuid(id) ? await svc.from('legal_obligations').select('id, entity_id, title, status').eq('id', id).in('entity_id', companyIds).maybeSingle() : { data: null };
  if (!o) throw new ApiError(404, 'not_found', 'No such deadline in this company.');
  const b = await body();
  const status = str(b, 'status', 20, true);
  if (!['done', 'not_needed', 'open'].includes(status)) throw new ApiError(422, 'bad_field', '“status” must be done, not_needed or open.', { field: 'status' });
  const note = str(b, 'note', 2000);
  if (status === 'not_needed' && !note) throw new ApiError(422, 'missing_field', 'Say why it isn’t needed, in “note”.', { field: 'note' });
  const doneOn = str(b, 'done_on', 10) || todayIn();
  if (!isDay(doneOn)) throw new ApiError(422, 'bad_field', '“done_on” must be YYYY-MM-DD.', { field: 'done_on' });
  const change = status === 'open' ? { status, done_on: null, done_by: null } : { status, done_on: doneOn, done_by: null, done_note: note };
  await svc.from('legal_obligations').update(change).eq('id', o.id).throwOnError();
  await audit(status === 'done' ? 'api_completed_legal_item' : status === 'not_needed' ? 'api_marked_legal_item_not_needed' : 'api_reopened_legal_item', { entity_id: o.entity_id, obligation_id: o.id, title: o.title, note });
  return json({ data: { id: o.id, title: o.title, status, done_on: status === 'open' ? null : doneOn } });
});
