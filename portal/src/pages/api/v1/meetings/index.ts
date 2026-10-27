import { ApiError, endpoint, json, page, str } from '../../../../lib/api/core';

/** GET /api/v1/meetings — meetings (AGMs, EGMs), newest first. ?status=upcoming|open|closed|results. */
export const GET = endpoint('meetings', { scope: 'meetings.view' }, async ({ svc, ctx, companyIds }) => {
  const p = page(ctx.url);
  let q = svc.from('meetings').select('id, title, kind, starts_at, location, livestream_url, proxy_deadline, status, notice_document_id, minutes_document_id, created_at, entities(code)', { count: 'exact' }).in('entity_id', companyIds).order('starts_at', { ascending: false });
  const status = ctx.url.searchParams.get('status');
  if (status) q = q.eq('status', status);
  const { data, count } = await q.range(p.from, p.to);
  return json({ data: (data ?? []).map(({ entities, ...m }) => ({ company: (entities as unknown as { code: string }).code, ...m })), total: count ?? 0, next_cursor: p.next(count ?? 0) });
});

/**
 * POST /api/v1/meetings — { title, kind (agm|egm), starts_at, proxy_deadline (ISO date-times), location,
 * livestream_url }. Created as "upcoming": opening proxy voting (which tells shareholders) is done in the
 * portal. Needs "meetings.do".
 */
export const POST = endpoint('meetings', { scope: 'meetings.do', write: true }, async ({ svc, company, body, audit }) => {
  const b = await body();
  const title = str(b, 'title', 200, true);
  const starts = str(b, 'starts_at', 40, true), deadline = str(b, 'proxy_deadline', 40, true);
  if (Number.isNaN(Date.parse(starts)) || Number.isNaN(Date.parse(deadline))) throw new ApiError(422, 'bad_field', '“starts_at” and “proxy_deadline” must be date-times, e.g. 2026-11-30T10:00:00+11:00.');
  if (Date.parse(deadline) > Date.parse(starts)) throw new ApiError(422, 'bad_field', 'The proxy deadline must be before the meeting starts.');
  const { data, error } = await svc.from('meetings').insert({ entity_id: company.id, title, kind: b.kind === 'egm' ? 'egm' : 'agm', starts_at: new Date(starts).toISOString(), proxy_deadline: new Date(deadline).toISOString(), location: str(b, 'location', 200) || null, livestream_url: str(b, 'livestream_url', 500) || null, status: 'upcoming' }).select('id').single();
  if (error || !data) throw new ApiError(422, 'not_added', error?.message ?? 'Couldn’t create the meeting.');
  await audit('admin_created_meeting', { meeting_id: data.id, title });
  return json({ data: { id: data.id, title, status: 'upcoming' } }, 201);
});
