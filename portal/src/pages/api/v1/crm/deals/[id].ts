import { ApiError, endpoint, isDay, isUuid, json, str, type Svc } from '../../../../../lib/api/core';
import { CURRENCIES, logActivity, pipelines } from '../../../../../lib/crm';
import { DEAL_COLUMNS, crmCompanyIds, dealOut } from '../../../../../lib/crm-api';

/**
 * GET /api/v1/crm/deals/{id} — one deal. PATCH — change its stage (by name; won and lost close it, lost needs
 * lost_reason), value, currency, expected close or next step.
 */
const load = async (svc: Svc, id: string, companyIds: string[]) => {
  if (!isUuid(id)) throw new ApiError(404, 'not_found', 'No such deal.');
  const { data } = await svc.from('crm_deals').select(`${DEAL_COLUMNS}, entity_id, stage_id, pipeline_id`).eq('id', id).in('entity_id', await crmCompanyIds({ svc, companyIds })).maybeSingle();
  if (!data) throw new ApiError(404, 'not_found', 'No such deal.');
  return data as unknown as Record<string, unknown> & { id: string; entity_id: string; stage_id: string; pipeline_id: string; amount: number; currency: string; title: string };
};

export const GET = endpoint('crm/deals/{id}', { scope: 'crm.view' }, async ({ svc, ctx, companyIds }) => {
  const { entity_id: _e, stage_id: _s, pipeline_id: _p, ...d } = await load(svc, ctx.params.id!, companyIds);
  return json({ data: dealOut(d as never) });
});

export const PATCH = endpoint('crm/deals/{id}', { scope: 'crm.do', write: true }, async ({ svc, ctx, companyIds, body, audit }) => {
  const b = await body();
  const d = await load(svc, ctx.params.id!, companyIds);
  const changes: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (b.amount !== undefined) { const n = Number(b.amount); if (!Number.isFinite(n) || n < 0) throw new ApiError(422, 'bad_field', '“amount” must be a number of at least 0.', { field: 'amount' }); changes.amount = n; }
  if (b.currency !== undefined) { const c = str(b, 'currency', 3).toUpperCase(); if (!CURRENCIES.includes(c)) throw new ApiError(422, 'bad_field', `“currency” must be one of ${CURRENCIES.join(', ')}.`, { field: 'currency' }); changes.currency = c; }
  if (b.expected_close !== undefined) { const v = str(b, 'expected_close', 10); if (v && !isDay(v)) throw new ApiError(422, 'bad_field', '“expected_close” must be a date, YYYY-MM-DD.', { field: 'expected_close' }); changes.expected_close = v || null; }
  if (b.next_step !== undefined) changes.next_step = str(b, 'next_step', 300);
  if (b.title !== undefined) changes.title = str(b, 'title', 200, true);
  if (b.stage !== undefined) {
    const stages = (await pipelines(svc, d.entity_id, true)).find((p) => p.id === d.pipeline_id)?.stages ?? [];
    const s = stages.find((x) => x.name.toLowerCase() === str(b, 'stage', 60).toLowerCase());
    if (!s) throw new ApiError(422, 'bad_stage', `Stages: ${stages.map((x) => x.name).join(', ')}.`, { field: 'stage' });
    if (s.kind === 'lost' && !str(b, 'lost_reason', 500)) throw new ApiError(422, 'missing_field', '“lost_reason” is required to mark a deal lost.', { field: 'lost_reason' });
    if (s.id !== d.stage_id) {
      const now = new Date().toISOString();
      Object.assign(changes, { stage_id: s.id, status: s.kind, stage_changed_at: now, won_at: s.kind === 'won' ? now : null, lost_at: s.kind === 'lost' ? now : null, lost_reason: s.kind === 'lost' ? str(b, 'lost_reason', 500) : '' });
      await logActivity(svc, { entity_id: d.entity_id, kind: 'stage', deal_id: d.id, subject: `→ ${s.name} (through the API)` });
    }
  }
  const { data } = await svc.from('crm_deals').update(changes).eq('id', d.id).select(DEAL_COLUMNS).single().throwOnError();
  await audit(changes.status === 'won' ? 'crm_deal_won' : changes.status === 'lost' ? 'crm_deal_lost' : changes.stage_id ? 'crm_deal_stage_changed' : 'crm_deal_changed', { entity_id: d.entity_id, deal_id: d.id });
  return json({ data: dealOut(data as never) });
});
