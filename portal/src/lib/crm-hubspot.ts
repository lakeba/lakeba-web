import { HUBSPOT_API_BASE } from 'astro:env/server';
import type { serviceClient } from './admin';
import { outboundJson } from './outbound';
import { accessToken, connectionOf } from './integrations/connections';
import { CURRENCIES, companyDomainOf, ensureRelationship, findOrCreateCompany, findOrCreatePerson, logActivity, pipelines } from './crm';

// Moving in from HubSpot (CRM → Import → From HubSpot), through the company's existing HubSpot connection:
// its companies, contacts and deals (with their associations and stages). Every record keeps its HubSpot id,
// so importing again matches instead of duplicating. HubSpot is only read.

type Svc = ReturnType<typeof serviceClient>;
type Obj = { id: string; properties: Record<string, string | null>; associations?: Record<string, { results: { id: string }[] }> };
const LIFECYCLE: Record<string, string> = { subscriber: 'lead', lead: 'lead', marketingqualifiedlead: 'lead', salesqualifiedlead: 'prospect', opportunity: 'prospect', customer: 'customer', evangelist: 'customer', other: 'other' };

export async function hubspotConnected(svc: Svc, entityId: string) {
  const c = await connectionOf(svc, entityId, 'hubspot');
  return c && c.status === 'connected' ? c : null;
}

async function all(token: string, object: string, props: string[], assoc = '') {
  const out: Obj[] = [];
  let after: string | undefined;
  for (let i = 0; i < 100; i++) {
    const res = await outboundJson<{ results: Obj[]; paging?: { next?: { after: string } } }>('GET', `${HUBSPOT_API_BASE}/crm/v3/objects/${object}?limit=100&properties=${props.join(',')}${assoc ? `&associations=${assoc}` : ''}${after ? `&after=${after}` : ''}`, undefined, { authorization: `Bearer ${token}` });
    out.push(...res.results);
    after = res.paging?.next?.after;
    if (!after || out.length >= 10_000) break;
  }
  return out;
}

export async function importHubSpot(svc: Svc, o: { entityId: string; central: string; userId: string; currency: string }) {
  const c = await hubspotConnected(svc, o.entityId);
  if (!c) throw new Error('HubSpot isn’t connected for this company (Settings → Companies → Integrations).');
  const token = await accessToken(svc, c, o.central);
  const ext = (id: string) => ({ hubspot: id });
  const counts = { companies: 0, people: 0, deals: 0, existing: 0 };
  // Companies
  const orgOf = new Map<string, string>();
  for (const x of await all(token, 'companies', ['name', 'domain', 'industry', 'country', 'city'])) {
    const p = x.properties;
    if (!p.name && !p.domain) continue;
    const org = await findOrCreateCompany(svc, { name: p.name || p.domain!, domain: p.domain, country: p.country ?? '', source: 'hubspot', createdBy: o.userId, external: ext(x.id) });
    if (org.created) { counts.companies++; if (p.industry || p.city) await svc.from('crm_companies').update({ industry: (p.industry ?? '').slice(0, 100), city: (p.city ?? '').slice(0, 100) }).eq('id', org.id); } else counts.existing++;
    await ensureRelationship(svc, o.entityId, { company_id: org.id }, { kind: 'prospect', createdBy: o.userId });
    orgOf.set(x.id, org.id);
  }
  // Contacts
  const personOf = new Map<string, string>();
  for (const x of await all(token, 'contacts', ['firstname', 'lastname', 'email', 'jobtitle', 'phone', 'lifecyclestage', 'company'], 'companies')) {
    const p = x.properties;
    const name = [p.firstname, p.lastname].filter(Boolean).join(' ');
    if (!name && !p.email) continue;
    const orgId = x.associations?.companies?.results?.[0]?.id ? orgOf.get(x.associations.companies.results[0].id) ?? null : null;
    const org = orgId ? { id: orgId } : p.company || companyDomainOf(p.email) ? await findOrCreateCompany(svc, { name: p.company || companyDomainOf(p.email)!, domain: companyDomainOf(p.email), source: 'hubspot', createdBy: o.userId }) : null;
    const person = await findOrCreatePerson(svc, { full_name: name || p.email!, email: p.email, phone: p.phone ?? '', job_title: p.jobtitle ?? '', company_id: org?.id ?? null, source: 'hubspot', createdBy: o.userId, external: ext(x.id) });
    if (person.created) counts.people++; else counts.existing++;
    await ensureRelationship(svc, o.entityId, { person_id: person.id }, { kind: LIFECYCLE[p.lifecyclestage ?? ''] ?? 'lead', createdBy: o.userId });
    personOf.set(x.id, person.id);
  }
  // Deals, in the company's first pipeline, by stage name (won and lost by HubSpot's closed stages).
  const list = await pipelines(svc, o.entityId);
  const pipe = list[0];
  if (pipe) {
    const stageNames = new Map<string, { label: string; won: boolean; lost: boolean }>();
    try {
      const ps = await outboundJson<{ results: { stages: { id: string; label: string; metadata?: { isClosed?: string; probability?: string } }[] }[] }>('GET', `${HUBSPOT_API_BASE}/crm/v3/pipelines/deals`, undefined, { authorization: `Bearer ${token}` });
      for (const pl of ps.results) for (const s of pl.stages) stageNames.set(s.id, { label: s.label, won: s.metadata?.isClosed === 'true' && s.metadata?.probability === '1.0', lost: s.metadata?.isClosed === 'true' && s.metadata?.probability === '0.0' });
    } catch { /* stages then by id */ }
    const won = pipe.stages.find((s) => s.kind === 'won'), lost = pipe.stages.find((s) => s.kind === 'lost'), first = pipe.stages.find((s) => s.kind === 'open')!;
    for (const x of await all(token, 'deals', ['dealname', 'amount', 'dealstage', 'closedate', 'deal_currency_code'], 'companies,contacts')) {
      const { data: dup } = await svc.from('crm_deals').select('id').eq('entity_id', o.entityId).contains('external_ids', ext(x.id)).limit(1);
      if (dup?.length) { counts.existing++; continue; }
      const p = x.properties;
      const hsStage = stageNames.get(p.dealstage ?? '');
      const stage = hsStage?.won ? won : hsStage?.lost ? lost : pipe.stages.find((s) => s.kind === 'open' && s.name.toLowerCase() === (hsStage?.label ?? '').toLowerCase()) ?? first;
      const cur = (p.deal_currency_code ?? '').toUpperCase();
      const orgId = x.associations?.companies?.results?.[0]?.id ? orgOf.get(x.associations.companies.results[0].id) ?? null : null;
      const personId = x.associations?.contacts?.results?.[0]?.id ? personOf.get(x.associations.contacts.results[0].id) ?? null : null;
      const now = new Date().toISOString();
      const { data: d } = await svc.from('crm_deals').insert({
        entity_id: o.entityId, pipeline_id: pipe.id, stage_id: stage!.id, status: stage!.kind, title: (p.dealname || 'Deal from HubSpot').slice(0, 200), company_id: orgId, person_id: personId, owner_id: o.userId,
        amount: Math.max(0, Number(p.amount) || 0), currency: CURRENCIES.includes(cur) ? cur : o.currency, expected_close: p.closedate ? p.closedate.slice(0, 10) : null, source: 'HubSpot',
        won_at: stage!.kind === 'won' ? now : null, lost_at: stage!.kind === 'lost' ? now : null, external_ids: ext(x.id), created_by: o.userId,
      }).select('id').single().throwOnError();
      if (personId) await svc.from('crm_deal_people').insert({ deal_id: d!.id, person_id: personId, part: 'involved' });
      await logActivity(svc, { entity_id: o.entityId, kind: 'system', deal_id: d!.id, subject: `Imported from HubSpot${hsStage ? ` (stage “${hsStage.label}”)` : ''}`, created_by: o.userId });
      counts.deals++;
    }
  }
  return counts;
}
