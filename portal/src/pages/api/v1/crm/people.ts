import { ApiError, endpoint, json, page, since, str } from '../../../../lib/api/core';
import { KINDS, cleanEmail, companyDomainOf, ensureRelationship, findOrCreateCompany, findOrCreatePerson, logActivity, validEmail } from '../../../../lib/crm';
import { crmCompanyIds, crmCompanyOf } from '../../../../lib/crm-api';

/**
 * GET /api/v1/crm/people — the people the company's CRM knows, with what they are to it (needs people.read).
 * POST — add someone (a website form, an event list): matched by email to anyone the group already knows.
 */
export const GET = endpoint('crm/people', { scope: 'crm.view' }, async ({ svc, ctx, companyIds, can }) => {
  if (!can('people.read')) throw new ApiError(403, 'insufficient_scope', 'Reading people needs the “people.read” scope too.', { required_scope: 'people.read' });
  const p = page(ctx.url);
  let q = svc.from('crm_relationships').select('kind, owner_id, last_contact_at, updated_at, entities(code), crm_people!inner(id, full_name, email, phone, job_title, city, country, linkedin_url, company_id, external_ids, created_at, updated_at)', { count: 'exact' })
    .in('entity_id', await crmCompanyIds({ svc, companyIds })).not('person_id', 'is', null).is('archived_at', null).order('updated_at', { ascending: false });
  const kind = ctx.url.searchParams.get('kind');
  if (kind) { if (!(kind in KINDS)) throw new ApiError(400, 'bad_kind', `kind must be one of ${Object.keys(KINDS).join(', ')}.`); q = q.eq('kind', kind); }
  const after = since(ctx.url);
  if (after) q = q.gte('updated_at', after);
  const { data, count } = await q.range(p.from, p.to);
  type R = { kind: string; owner_id: string | null; last_contact_at: string | null; entities: { code: string } | null; crm_people: Record<string, unknown> };
  return json({ data: ((data ?? []) as unknown as R[]).map((r) => ({ company: r.entities?.code, ...r.crm_people, kind: r.kind, owner_id: r.owner_id, last_contact_at: r.last_contact_at })), total: count ?? 0, next_cursor: p.next(count ?? 0) });
});

export const POST = endpoint('crm/people', { scope: 'crm.do', write: true }, async ({ svc, companyIds, body, audit }) => {
  const b = await body();
  const company = await crmCompanyOf({ svc, companyIds });
  const email = cleanEmail(str(b, 'email', 200));
  if (email && !validEmail(email)) throw new ApiError(422, 'bad_field', '“email” isn’t an email address.', { field: 'email' });
  const name = str(b, 'full_name', 200);
  if (!name && !email) throw new ApiError(422, 'missing_field', '“full_name” or “email” is required.', { field: 'full_name' });
  const kind = str(b, 'kind', 30) || 'lead';
  if (!(kind in KINDS)) throw new ApiError(422, 'bad_field', `“kind” must be one of ${Object.keys(KINDS).join(', ')}.`, { field: 'kind' });
  const orgName = str(b, 'organisation', 200);
  const domain = companyDomainOf(email);
  const org = orgName || domain ? await findOrCreateCompany(svc, { name: orgName || domain!, domain, source: 'api' }) : null;
  const p = await findOrCreatePerson(svc, { full_name: name || email, email: email || null, phone: str(b, 'phone', 50), job_title: str(b, 'job_title', 200), company_id: org?.id ?? null, source: str(b, 'source', 30) || 'api' });
  await ensureRelationship(svc, company.id, { person_id: p.id }, { kind });
  if (org) await ensureRelationship(svc, company.id, { company_id: org.id }, { kind: kind === 'student' ? 'other' : kind });
  const note = str(b, 'note', 5000);
  if (note) await logActivity(svc, { entity_id: company.id, kind: 'form', direction: 'in', person_id: p.id, company_id: org?.id ?? null, subject: str(b, 'subject', 200) || 'From your website or app', body: note });
  await audit('crm_person_added', { entity_id: company.id, person_id: p.id, existing: !p.created });
  return json({ data: { id: p.id, existing: !p.created, organisation_id: org?.id ?? null, kind } }, p.created ? 201 : 200);
});
