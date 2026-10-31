import { endpoint, json, page, since } from '../../../../lib/api/core';
import { crmCompanyIds } from '../../../../lib/crm-api';

/** GET /api/v1/crm/companies — the organisations the company's CRM knows (customers, prospects, partners), with what they are to it. */
export const GET = endpoint('crm/companies', { scope: 'crm.view' }, async ({ svc, ctx, companyIds }) => {
  const p = page(ctx.url);
  let q = svc.from('crm_relationships').select('kind, owner_id, last_contact_at, xero_contact_id, updated_at, entities(code), crm_companies!inner(id, name, domain, country, city, industry, size_band, external_ids, created_at, updated_at)', { count: 'exact' })
    .in('entity_id', await crmCompanyIds({ svc, companyIds })).not('company_id', 'is', null).is('archived_at', null).order('updated_at', { ascending: false });
  const after = since(ctx.url);
  if (after) q = q.gte('updated_at', after);
  const { data, count } = await q.range(p.from, p.to);
  type R = { kind: string; owner_id: string | null; last_contact_at: string | null; xero_contact_id: string | null; entities: { code: string } | null; crm_companies: Record<string, unknown> };
  return json({ data: ((data ?? []) as unknown as R[]).map((r) => ({ company: r.entities?.code, ...r.crm_companies, kind: r.kind, owner_id: r.owner_id, last_contact_at: r.last_contact_at, xero_contact_id: r.xero_contact_id })), total: count ?? 0, next_cursor: p.next(count ?? 0) });
});
