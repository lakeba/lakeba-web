import { ApiError, endpoint, isUuid, json, str, type Svc } from '../../../../../lib/api/core';
import { notifyMembers } from '../../../../../lib/notify';
import { BS_LINES, financeTeam, PL_LINES, periodLabel, type Figures } from '../../../../../lib/reporting';

const COLUMNS = 'id, entity_id, period_end, cadence, due_on, status, source, figures, note, submitted_at, reviewed_at, updated_at, entities(code, display_name)';
async function packOf(svc: Svc, id: string | undefined, companyIds: string[]) {
  const { data } = isUuid(id) ? await svc.from('reporting_packs').select(COLUMNS).eq('id', id).in('entity_id', companyIds).maybeSingle() : { data: null };
  if (!data) throw new ApiError(404, 'not_found', 'No such reporting pack in this company.');
  return data as unknown as { id: string; entity_id: string; period_end: string; cadence: string; due_on: string; status: string; source: string | null; figures: Figures; note: string; submitted_at: string | null; reviewed_at: string | null; updated_at: string; entities: { code: string; display_name: string } };
}
const view = ({ entity_id: _e, entities, ...p }: Awaited<ReturnType<typeof packOf>>) => ({ company: entities.code, ...p });

/** GET /api/v1/reporting/packs/{id} — a pack, its figures and the messages between Lakeba and the company about it. */
export const GET = endpoint('reporting/packs/{id}', { scope: 'reporting.view' }, async ({ svc, ctx, companyIds }) => {
  const p = await packOf(svc, ctx.params.id, companyIds);
  const { data: msgs } = await svc.from('reporting_pack_messages').select('body, created_at').eq('pack_id', p.id).order('created_at');
  return json({ data: { ...view(p), messages: msgs ?? [] } });
});

const amount = (v: unknown, where: string) => {
  if (v === null || v === undefined) return null;
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new ApiError(422, 'bad_field', `“${where}” must be a number (whole units) or null.`, { field: where });
  return Math.round(v);
};

/**
 * PUT /api/v1/reporting/packs/{id} — { figures: { pl: { <line>: { period, ytd } }, bs: { <line>: n } }, note,
 * send } fills a pack that's still with the company (open, or returned with a question) from its accounting
 * system, in the schedule's currency, whole units. send: true sends it to Lakeba (Lakeba's finance team is
 * told), as Send does in the portal. Needs "reporting.do".
 */
export const PUT = endpoint('reporting/packs/{id}', { scope: 'reporting.do', write: true }, async ({ svc, ctx, companyIds, body, audit }) => {
  const p = await packOf(svc, ctx.params.id, companyIds);
  if (!['open', 'returned'].includes(p.status)) throw new ApiError(409, 'not_editable', `This pack is ${p.status === 'submitted' ? 'already with Lakeba' : 'accepted'}: it can’t be changed.`);
  const b = await body();
  const f = (b.figures ?? {}) as { pl?: Record<string, unknown>; bs?: Record<string, unknown> };
  if (typeof f !== 'object' || Array.isArray(f)) throw new ApiError(422, 'bad_field', '“figures” must be an object with pl and bs.', { field: 'figures' });
  const unknownLine = [...Object.keys(f.pl ?? {}).filter((k) => !(k in PL_LINES)).map((k) => `pl.${k}`), ...Object.keys(f.bs ?? {}).filter((k) => !(k in BS_LINES)).map((k) => `bs.${k}`)];
  if (unknownLine.length) throw new ApiError(422, 'unknown_line', `Unknown lines: ${unknownLine.join(', ')}. The lines are listed in the reference.`, { lines: unknownLine });
  const figures: Figures = {
    pl: Object.fromEntries(Object.keys(PL_LINES).map((k) => { const x = (f.pl?.[k] ?? {}) as Record<string, unknown>; return [k, { period: amount(x.period, `pl.${k}.period`), ytd: amount(x.ytd, `pl.${k}.ytd`) }]; })),
    bs: Object.fromEntries(Object.keys(BS_LINES).map((k) => [k, amount(f.bs?.[k], `bs.${k}`)])),
    ic: p.figures.ic ?? [],
  };
  const note = b.note === undefined ? p.note : str(b, 'note', 5000);
  const send = b.send === true;
  const filled = Object.values(figures.pl ?? {}).some((v) => v?.period != null) || Object.values(figures.bs ?? {}).some((v) => v != null);
  if (send && !filled) throw new ApiError(422, 'no_figures', 'Fill in the figures before sending.');
  const now = new Date().toISOString();
  await svc.from('reporting_packs').update({ figures, note, source: 'api', updated_at: now, ...(send ? { status: 'submitted', submitted_by: null, submitted_at: now } : {}) }).eq('id', p.id).throwOnError();
  const detail = { entity_id: p.entity_id, pack_id: p.id, period_end: p.period_end };
  if (send) {
    const label = periodLabel(p.period_end, p.cadence);
    const company = p.entities.display_name;
    await notifyMembers({ kind: 'reporting', userIds: await financeTeam(svc), origin: ctx.url.origin, link: `/admin/accounting/packs/${p.id}`, title: `${company} sent its ${label} pack`, body: `${company}’s profit and loss and balance sheet for ${label} are ready to review.` }).catch(() => 0);
    await audit('sent_reporting_pack', detail);
  } else await audit('api_saved_reporting_pack', detail);
  return json({ data: view(await packOf(svc, p.id, companyIds)) });
});
