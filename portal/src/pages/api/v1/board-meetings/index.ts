import { endpoint, json, page } from '../../../../lib/api/core';
import { attendeesView, minutesOf, type Attendee } from '../../../../lib/api/data';

/**
 * GET /api/v1/board-meetings — directors' meetings (not shareholder meetings, which are /meetings),
 * newest first: attendance, recording and the minutes' status.
 */
export const GET = endpoint('board-meetings', { scope: 'boardroom.view' }, async ({ svc, ctx, companyIds, can }) => {
  const p = page(ctx.url);
  const { data, count } = await svc.from('board_meetings').select('id, title, held_at, location, attendees, recording_status, transcript_source, created_at, updated_at, entities(code)', { count: 'exact' }).in('entity_id', companyIds).order('held_at', { ascending: false }).range(p.from, p.to);
  const minutes = await minutesOf(svc, (data ?? []).map((m) => m.id));
  const personal = can('people.read');
  return json({ data: (data ?? []).map(({ entities, attendees, transcript_source, ...m }) => ({ company: (entities as unknown as { code: string }).code, ...m, attendees: attendeesView(attendees as Attendee[], personal), has_transcript: Boolean(transcript_source), minutes: minutes.get(m.id) ?? null })), total: count ?? 0, next_cursor: p.next(count ?? 0) });
});
