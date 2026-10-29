import { ApiError, endpoint, isUuid, json } from '../../../../lib/api/core';
import { attendeesView, minutesOf } from '../../../../lib/api/data';

/**
 * GET /api/v1/board-meetings/{id} — a directors' meeting: agenda, attendance, the minutes' status, the decks
 * presented and how many questions Lex answered. ?include=transcript adds the transcript (it has the
 * speakers' names, so it also needs "people.read").
 */
export const GET = endpoint('board-meetings/{id}', { scope: 'boardroom.view' }, async ({ svc, ctx, companyIds, can }) => {
  const id = ctx.params.id;
  const { data: m } = isUuid(id) ? await svc.from('board_meetings').select('id, title, held_at, location, agenda, attendees, recording_status, transcript, transcript_source, created_at, updated_at, entities(code)').eq('id', id).in('entity_id', companyIds).maybeSingle() : { data: null };
  if (!m) throw new ApiError(404, 'not_found', 'No such board meeting in this company.');
  const withTranscript = ctx.url.searchParams.get('include') === 'transcript';
  if (withTranscript && !can('people.read')) throw new ApiError(403, 'insufficient_scope', 'The transcript has the speakers’ names: this key also needs the “people.read” scope.', { required_scope: 'people.read' });
  const [minutes, { data: decks }, { count: lex }] = await Promise.all([
    minutesOf(svc, [m.id]),
    svc.from('board_decks').select('id, title, role, source, status, presented_at').eq('meeting_id', m.id).order('created_at'),
    svc.from('board_meeting_assistant').select('id', { count: 'exact', head: true }).eq('meeting_id', m.id).eq('status', 'done'),
  ]);
  const { entities, attendees, transcript, transcript_source, ...rest } = m;
  return json({ data: { company: (entities as unknown as { code: string }).code, ...rest, attendees: attendeesView(attendees as never, can('people.read')), has_transcript: Boolean(transcript_source),
    minutes: minutes.get(m.id) ?? null, decks: decks ?? [], lex_answers: lex ?? 0, ...(withTranscript ? { transcript: transcript ?? '' } : {}) } });
});
