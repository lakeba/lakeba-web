import { ApiError, endpoint, isUuid, json } from '../../../../lib/api/core';

/** GET /api/v1/meetings/{id} — a meeting, its resolutions with outcomes and proxy vote totals, and how many questions were sent. */
export const GET = endpoint('meetings/{id}', { scope: 'meetings.view' }, async ({ svc, ctx, companyIds }) => {
  const id = ctx.params.id;
  const { data: m } = isUuid(id) ? await svc.from('meetings').select('id, title, kind, starts_at, location, livestream_url, proxy_deadline, status, notice_document_id, minutes_document_id, created_at, entities(code)').eq('id', id).in('entity_id', companyIds).maybeSingle() : { data: null };
  if (!m) throw new ApiError(404, 'not_found', 'No such meeting in this company.');
  const [{ data: rs }, { data: tally }, { count: questions }] = await Promise.all([
    svc.from('resolutions').select('id, number, title, description, kind, outcome').eq('meeting_id', id!).order('number'),
    svc.rpc('resolution_tally', { target_meeting: id }),
    svc.from('meeting_questions').select('id', { count: 'exact', head: true }).eq('meeting_id', id!),
  ]);
  const t = (tally ?? []) as { resolution_id: string; vote: string; holders: number; shares: number }[];
  const { entities, ...rest } = m;
  return json({ data: { company: (entities as unknown as { code: string }).code, ...rest, questions: questions ?? 0,
    resolutions: (rs ?? []).map((r) => ({ ...r, proxy_votes: Object.fromEntries(['for', 'against', 'abstain'].map((v) => { const x = t.find((y) => y.resolution_id === r.id && y.vote === v); return [v, { holders: Number(x?.holders ?? 0), shares: Number(x?.shares ?? 0) }]; })) })) } });
});
