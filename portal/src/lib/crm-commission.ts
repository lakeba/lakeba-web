import type { serviceClient } from './admin';
import { allocate, ATTRIBUTION_COLUMNS, ASSIGNMENT_COLUMNS, PLAN_COLUMNS, type Assignment, type Attribution, type Plan } from './commissions';
import { logActivity, toBase } from './crm';

// The CRM and commissions (HR → Commissions): a deal's owner is credited with its client in Xero as soon as
// the deal has a Xero contact, so commission runs pay them for its invoices; and each deal shows roughly what
// it would pay its owner, from their plan and how far they are into their target this quarter.

type Svc = ReturnType<typeof serviceClient>;
const today = () => new Date().toISOString().slice(0, 10);

/** The salesperson's HR record at this company (commission plans are for people in HR). */
async function hrPerson(svc: Svc, entityId: string, userId: string) {
  const { data } = await svc.from('people').select('id, full_name').eq('entity_id', entityId).eq('user_id', userId).neq('status', 'left').limit(1).maybeSingle();
  return data as { id: string; full_name: string } | null;
}

/** Credits the deal's owner with its Xero client, unless someone already is (Finance's split stays as it is). */
export async function creditOwner(svc: Svc, deal: { id: string; entity_id: string; owner_id: string | null; xero_contact_id: string | null }, contactName: string) {
  if (!deal.owner_id || !deal.xero_contact_id) return null;
  const person = await hrPerson(svc, deal.entity_id, deal.owner_id);
  if (!person) return null;
  const { data } = await svc.from('commission_attributions').select(ATTRIBUTION_COLUMNS).eq('entity_id', deal.entity_id).eq('xero_contact_id', deal.xero_contact_id);
  const now = today();
  if (((data ?? []) as Attribution[]).some((a) => a.starts_on <= now && (!a.ends_on || a.ends_on >= now))) return null;
  await svc.from('commission_attributions').insert({ entity_id: deal.entity_id, xero_contact_id: deal.xero_contact_id, contact_name: contactName.slice(0, 300), person_id: person.id, share: 100, starts_on: now, ends_on: null, created_by: deal.owner_id }).throwOnError();
  await logActivity(svc, { entity_id: deal.entity_id, kind: 'system', deal_id: deal.id, subject: `${person.full_name} is credited with ${contactName} for commission` });
  return person.full_name;
}

/** About what this deal pays its owner: their plan's tiers on top of what they were paid for this quarter. */
export async function worthToOwner(svc: Svc, deal: { entity_id: string; owner_id: string | null; amount: number; currency: string; status: string }, company: { crm_currency: string; crm_fx?: Record<string, number> | null }) {
  if (!deal.owner_id || deal.status === 'lost') return null;
  const person = await hrPerson(svc, deal.entity_id, deal.owner_id);
  if (!person) return null;
  const now = today();
  const { data: as } = await svc.from('commission_assignments').select(ASSIGNMENT_COLUMNS).eq('person_id', person.id);
  const a = ((as ?? []) as Assignment[]).find((x) => x.starts_on <= now && (!x.ends_on || x.ends_on >= now));
  if (!a) return null;
  const { data: p } = await svc.from('commission_plans').select(PLAN_COLUMNS).eq('id', a.plan_id).maybeSingle();
  const plan = p as Plan | null;
  if (!plan?.active) return null;
  // Paid this quarter (won deals), in the CRM's currency: where the next deal lands on the tiers.
  const d = new Date();
  const qStart = new Date(Date.UTC(d.getUTCFullYear(), Math.floor(d.getUTCMonth() / 3) * 3, 1)).toISOString();
  const { data: won } = await svc.from('crm_deals').select('amount, currency').eq('entity_id', deal.entity_id).eq('owner_id', deal.owner_id).eq('status', 'won').gte('won_at', qStart);
  const before = ((won ?? []) as { amount: number; currency: string }[]).reduce((s, w) => s + toBase(Number(w.amount), w.currency, company), 0);
  const value = toBase(Number(deal.amount), deal.currency, company);
  // Plans' targets are per run period; the quarter's share of an annual target is a fair guide.
  const target = Number(a.target) || 0;
  if (!target) return null;
  const { commissions } = allocate([before, value], target, plan.tiers, plan.cap);
  return { amount: Math.round(commissions[1] ?? 0), currency: company.crm_currency, plan: plan.name, basis: plan.basis };
}
