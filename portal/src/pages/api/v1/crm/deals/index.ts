import { ApiError, endpoint, isDay, json, page, since, str } from '../../../../../lib/api/core';
import { CURRENCIES, cleanEmail, companyDomainOf, ensureRelationship, findOrCreateCompany, findOrCreatePerson, logActivity, pipelines, validEmail } from '../../../../../lib/crm';
import { DEAL_COLUMNS, crmCompanyIds, crmCompanyOf, dealOut } from '../../../../../lib/crm-api';

/**
 * GET /api/v1/crm/deals — the company's CRM deals with their pipeline, stage, value and company.
 * ?status=open|won|lost, ?updated_since=. POST — a new deal, its company and contact matched or added.
 */
export const GET = endpoint('crm/deals', { scope: 'crm.view' }, async ({ svc, ctx, companyIds }) => {
  const p = page(ctx.url);
  let q = svc.from('crm_deals').select(DEAL_COLUMNS, { count: 'exact' }).in('entity_id', await crmCompanyIds({ svc, companyIds })).order('updated_at', { ascending: false });
  const status = ctx.url.searchParams.get('status');
  if (status) { if (!['open', 'won', 'lost'].includes(status)) throw new ApiError(400, 'bad_status', 'status must be open, won or lost.'); q = q.eq('status', status); }
  const after = since(ctx.url);
  if (after) q = q.gte('updated_at', after);
  const { data, count } = await q.range(p.from, p.to);
  return json({ data: (data ?? []).map((d) => dealOut(d as never)), total: count ?? 0, next_cursor: p.next(count ?? 0) });
});

export const POST = endpoint('crm/deals', { scope: 'crm.do', write: true }, async ({ svc, companyIds, body, audit }) => {
  const b = await body();
  const company = await crmCompanyOf({ svc, companyIds });
  const list = await pipelines(svc, company.id);
  const pipeline = list.find((p) => p.id === b.pipeline_id) ?? list[0];
  if (!pipeline) throw new ApiError(409, 'no_pipeline', 'The CRM has no pipeline yet (CRM → Settings).');
  const stageName = str(b, 'stage', 60).toLowerCase();
  const stage = (stageName ? pipeline.stages.find((s) => s.name.toLowerCase() === stageName) : null) ?? pipeline.stages.find((s) => s.kind === 'open')!;
  if (stageName && stage.name.toLowerCase() !== stageName) throw new ApiError(422, 'bad_stage', `No stage “${b.stage}” in ${pipeline.name}. Stages: ${pipeline.stages.map((s) => s.name).join(', ')}.`);
  const amount = b.amount === undefined ? 0 : Number(b.amount);
  if (!Number.isFinite(amount) || amount < 0) throw new ApiError(422, 'bad_field', '“amount” must be a number of at least 0.', { field: 'amount' });
  const currency = str(b, 'currency', 3).toUpperCase() || company.crm_currency;
  if (!CURRENCIES.includes(currency)) throw new ApiError(422, 'bad_field', `“currency” must be one of ${CURRENCIES.join(', ')}.`, { field: 'currency' });
  const close = str(b, 'expected_close', 10);
  if (close && !isDay(close)) throw new ApiError(422, 'bad_field', '“expected_close” must be a date, YYYY-MM-DD.', { field: 'expected_close' });
  const org = (b.organisation ?? {}) as Record<string, unknown>;
  const contact = (b.contact ?? {}) as Record<string, unknown>;
  const email = cleanEmail(str(contact, 'email', 200));
  if (email && !validEmail(email)) throw new ApiError(422, 'bad_field', '“contact.email” isn’t an email address.', { field: 'contact.email' });
  const domain = str(org, 'domain', 200) || companyDomainOf(email);
  const orgName = str(org, 'name', 200);
  const o = orgName || domain ? await findOrCreateCompany(svc, { name: orgName || domain!, domain, source: 'api' }) : null;
  const person = str(contact, 'name', 200) || email ? await findOrCreatePerson(svc, { full_name: str(contact, 'name', 200) || email, email: email || null, job_title: str(contact, 'job_title', 200), company_id: o?.id ?? null, source: 'api' }) : null;
  if (o) await ensureRelationship(svc, company.id, { company_id: o.id }, { kind: 'prospect' });
  if (person) await ensureRelationship(svc, company.id, { person_id: person.id }, { kind: 'prospect' });
  const title = str(b, 'title', 200) || (orgName ? `${orgName} — new deal` : '');
  if (!title) throw new ApiError(422, 'missing_field', '“title” (or organisation.name) is required.', { field: 'title' });
  const ext = (b.external_ids && typeof b.external_ids === 'object' && !Array.isArray(b.external_ids)) ? Object.fromEntries(Object.entries(b.external_ids as Record<string, unknown>).filter(([, v]) => typeof v === 'string').slice(0, 10)) : {};
  const { data: d } = await svc.from('crm_deals').insert({
    entity_id: company.id, pipeline_id: pipeline.id, stage_id: stage.id, title, amount, currency, expected_close: close || null, company_id: o?.id ?? null, person_id: person?.id ?? null,
    source: str(b, 'source', 100), next_step: str(b, 'next_step', 300), external_ids: ext,
  }).select(DEAL_COLUMNS).single().throwOnError();
  if (person) await svc.from('crm_deal_people').insert({ deal_id: (d as { id: string }).id, person_id: person.id, part: 'involved' });
  await logActivity(svc, { entity_id: company.id, kind: 'system', deal_id: (d as { id: string }).id, subject: 'Created through the API' });
  await audit('crm_deal_created', { entity_id: company.id, deal_id: (d as { id: string }).id });
  return json({ data: dealOut(d as never) }, 201);
});
