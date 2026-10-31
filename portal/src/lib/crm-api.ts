import { ApiError, type Ctx } from './api/core';

// Helpers for the CRM's company API (/api/v1/crm/…): which company a request works on, and that its CRM is on.

/** The one company a CRM write applies to (an all-companies key names it with ?company=CODE). */
export async function crmCompanyOf(c: Pick<Ctx, 'svc' | 'companyIds'>) {
  if (c.companyIds.length !== 1) throw new ApiError(400, 'company_required', 'This key covers several companies: add ?company=CODE.');
  const { data } = await c.svc.from('entities').select('id, code, crm_enabled, crm_currency').eq('id', c.companyIds[0]).single();
  if (!data?.crm_enabled) throw new ApiError(409, 'crm_off', 'This company’s CRM is switched off (CRM → Settings).');
  return data as { id: string; code: string; crm_enabled: boolean; crm_currency: string };
}

/** Companies in view whose CRM is on (reads skip the others). */
export async function crmCompanyIds(c: Pick<Ctx, 'svc' | 'companyIds'>) {
  const { data } = await c.svc.from('entities').select('id').in('id', c.companyIds).eq('crm_enabled', true);
  return (data ?? []).map((e) => e.id as string).concat('00000000-0000-0000-0000-000000000000');
}

export const DEAL_COLUMNS = 'id, title, amount, currency, status, expected_close, next_step, next_step_on, source, won_at, lost_at, lost_reason, owner_id, company_id, person_id, external_ids, created_at, updated_at, entities(code), crm_pipelines(id, name), crm_stages(id, name, kind, chance), crm_companies!crm_deals_company_id_fkey(id, name, domain)';
type DealRow = Record<string, unknown> & { entities: { code: string } | null; crm_pipelines: unknown; crm_stages: unknown; crm_companies: unknown; amount: number | string };
export const dealOut = ({ entities, crm_pipelines, crm_stages, crm_companies, ...d }: DealRow) => ({ company: entities?.code, ...d, amount: Number(d.amount), pipeline: crm_pipelines, stage: crm_stages, organisation: crm_companies });
