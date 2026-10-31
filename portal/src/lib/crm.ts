import type { Access } from './access';
import type { serviceClient } from './admin';

// The CRM (Admin → CRM, or crm.{venture domain}; docs/crm.md). People and companies are held once for the
// whole group; everything else (relationships, deals, tasks, notes, activity) belongs to one venture and is
// seen only by those with the "crm" permission for it. A person works on one venture at a time: the one
// picked in the CRM's header (remembered with the admin's company filter).

type Svc = ReturnType<typeof serviceClient>;
const NONE = '00000000-0000-0000-0000-000000000000';

export type CrmCompany = { id: string; code: string; display_name: string; relationship: string; brand_color: string | null; logo_url: string | null; crm_enabled: boolean; crm_domain: string | null; crm_domain_verified_at: string | null; crm_currency: string };
const CRM_COLUMNS = 'id, code, display_name, relationship, brand_color, logo_url, crm_enabled, crm_domain, crm_domain_verified_at, crm_currency';

export type Stage = { id: string; pipeline_id: string; name: string; sort: number; kind: 'open' | 'won' | 'lost'; chance: number; exit_criteria: string; cold_after_days: number };
export type Pipeline = { id: string; entity_id: string; name: string; kind: 'deals' | 'partners' | 'people'; sort: number; archived_at: string | null; stages: Stage[] };
export type Deal = {
  id: string; entity_id: string; pipeline_id: string; stage_id: string; title: string; company_id: string | null; person_id: string | null; owner_id: string | null;
  amount: number; currency: string; expected_close: string | null; status: 'open' | 'won' | 'lost'; won_at: string | null; lost_at: string | null; lost_reason: string;
  next_step: string; next_step_on: string | null; source: string; referred_by_company_id: string | null; ai_chance: number | null; ai_review: unknown;
  fields: Record<string, unknown>; stage_changed_at: string; last_activity_at: string | null; created_at: string; updated_at: string;
};
export type Person = { id: string; full_name: string; email: string | null; other_emails: string[]; phone: string; mobile: string; job_title: string; company_id: string | null; linkedin_url: string; city: string; country: string; timezone: string; profile_id: string | null; source: string; created_at: string };
export type Org = { id: string; name: string; domain: string | null; country: string; city: string; industry: string; size_band: string; phone: string; linkedin_url: string; parent_id: string | null; created_at: string };
export type Relationship = { id: string; entity_id: string; person_id: string | null; company_id: string | null; kind: string; owner_id: string | null; warmth: number; xero_contact_id: string | null; shareable: boolean; tags: string[]; fields: Record<string, unknown>; last_contact_at: string | null; archived_at: string | null };
export type Task = { id: string; entity_id: string; title: string; kind: 'call' | 'email' | 'meeting' | 'todo'; due_on: string | null; owner_id: string | null; deal_id: string | null; person_id: string | null; company_id: string | null; done_at: string | null; suggested: boolean; created_at: string };
export type Activity = { id: string; entity_id: string; kind: string; direction: 'in' | 'out' | null; subject: string; body: string; deal_id: string | null; person_id: string | null; company_id: string | null; source_ref: string | null; meta: Record<string, unknown>; occurred_at: string; created_by: string | null };
export type Field = { id: string; entity_id: string; applies_to: 'deal' | 'person' | 'company'; key: string; label: string; type: 'text' | 'number' | 'date' | 'choice' | 'yes_no'; choices: string[]; sort: number };

export const KINDS: Record<string, string> = {
  lead: 'Lead', prospect: 'Prospect', customer: 'Customer', former_customer: 'Former customer', partner: 'Partner', supplier: 'Supplier',
  investor: 'Investor', student: 'Student', university: 'University', other: 'Other',
};
export const KINDS_PLURAL: Record<string, string> = {
  lead: 'Leads', prospect: 'Prospects', customer: 'Customers', former_customer: 'Former customers', partner: 'Partners', supplier: 'Suppliers',
  investor: 'Investors', student: 'Students', university: 'Universities', other: 'Other',
};
export const PARTS: Record<string, string> = { champion: 'Champion', decides: 'Decides', influences: 'Influences', blocks: 'May block', uses: 'Will use it', involved: 'Involved' };
export const TASK_KINDS: Record<string, string> = { call: 'Call', email: 'Email', meeting: 'Meeting', todo: 'To do' };
export const SOURCES = ['Website', 'Referral', 'Shareholder introduction', 'Introduction from a venture', 'Event', 'Webinar', 'Outbound', 'Inbound email', 'Partner', 'Press', 'Other'];
export const SIZE_BANDS = ['1-10', '11-50', '51-200', '201-1000', '1000+'];
export const CURRENCIES = ['AUD', 'CAD', 'EUR', 'USD', 'GBP', 'NZD', 'SGD'];

// ---------------------------------------------------------------------------
// Which companies, and what this person may do there
// ---------------------------------------------------------------------------

/** Companies whose CRM this person may open (switched on), or every company they could switch it on for (Admins). */
export async function crmCompanies(svc: Svc, access: Access, opts: { includeOff?: boolean } = {}) {
  // Selling (crm) or marketing (leadgen): either opens the company's CRM, each to its own pages.
  const a = access.companies('crm.view'), b = access.companies('leadgen.view');
  const ids = a === 'all' || b === 'all' ? 'all' : [...new Set([...a, ...b])];
  let q = svc.from('entities').select(CRM_COLUMNS).order('sort');
  if (ids !== 'all') q = q.in('id', ids.length ? ids : [NONE]);
  if (!opts.includeOff) q = q.eq('crm_enabled', true);
  return ((await q).data ?? []) as CrmCompany[];
}

export type CrmScope = {
  companies: CrmCompany[];
  current: CrmCompany | null;
  /** May add and change records (their own deals; every deal with approve). */
  canDo: boolean;
  /** Sales lead: every deal, approvals, settings. */
  canApprove: boolean;
  /** May change the CRM's settings (pipelines, fields, address): Admins of the company and sales leads. */
  canSettings: boolean;
  /** Sees the deals (Sales, Sales lead, Admin); marketing-only people see the marketing pages. */
  canSell: boolean;
  /** Works on forms, campaigns and sequences (CRM marketing). */
  canMarket: boolean;
};

/** The company the CRM works on: ?company=CODE, the admin's remembered pick, the address's venture, or the first. */
export async function crmScope(svc: Svc, locals: App.Locals, url: URL): Promise<CrmScope> {
  const companies = await crmCompanies(svc, locals.access);
  const code = (url.searchParams.get('company') ?? locals.crmCompany ?? locals.adminCompany ?? '').toUpperCase();
  const current = companies.find((c) => c.code === code) ?? companies[0] ?? null;
  const a = locals.access;
  return {
    companies, current,
    canDo: Boolean(current && a.can('crm.do', current.id)),
    canApprove: Boolean(current && a.can('crm.approve', current.id)),
    canSettings: Boolean(current && (a.can('crm.approve', current.id) || a.roles.some((r) => r.role_key === 'admin' && (r.entity_id === null || r.entity_id === current.id)))),
    canSell: Boolean(current && a.can('crm.view', current.id)),
    canMarket: Boolean(current && a.can('leadgen.do', current.id)),
  };
}

/** A sales lead changes any deal of the company; a salesperson their own and unassigned ones. */
export const mayEditDeal = (scope: CrmScope, d: Pick<Deal, 'owner_id'>, userId: string) => scope.canApprove || (scope.canDo && (!d.owner_id || d.owner_id === userId));

/** People who sell for a company (anyone whose role gives "crm.do" there): owners to choose from. */
export async function salesTeam(svc: Svc, entityId: string) {
  const { data: perms } = await svc.from('role_permissions').select('role_key').eq('permission', 'crm.do');
  const keys = (perms ?? []).map((p) => p.role_key);
  if (!keys.length) return [];
  const { data } = await svc.from('user_roles').select('user_id, role_key, profiles(first_name, last_name, email)').in('role_key', keys)
    .or(`entity_id.is.null,entity_id.eq.${entityId}`).or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`);
  const seen = new Map<string, { id: string; name: string; email: string; lead: boolean }>();
  for (const r of (data ?? []) as unknown as { user_id: string; role_key: string; profiles: { first_name: string; last_name: string; email: string } | null }[]) {
    const p = r.profiles;
    const name = `${p?.first_name ?? ''} ${p?.last_name ?? ''}`.trim() || p?.email || 'Someone';
    const prev = seen.get(r.user_id);
    seen.set(r.user_id, { id: r.user_id, name, email: p?.email ?? '', lead: Boolean(prev?.lead) || ['sales_lead', 'admin'].includes(r.role_key) });
  }
  return [...seen.values()].sort((x, y) => x.name.localeCompare(y.name));
}

// ---------------------------------------------------------------------------
// Pipelines
// ---------------------------------------------------------------------------

type StageSpec = [name: string, chance: number, kind?: 'won' | 'lost', exit?: string];
/** Ready-made pipelines a venture starts from (Settings → Pipelines), changeable afterwards. */
export const TEMPLATES: Record<string, { label: string; kind: Pipeline['kind']; name: string; stages: StageSpec[] }> = {
  b2b: { label: 'B2B sales', kind: 'deals', name: 'Sales', stages: [
    ['Discovery', 10, undefined, 'We know their problem, who decides and roughly when.'],
    ['Demo', 25, undefined, 'They have seen it working on their own case.'],
    ['Evaluation', 40, undefined, 'IT, security and the users have what they need to say yes.'],
    ['Proposal', 60, undefined, 'A quote is with the person who decides.'],
    ['Negotiation', 80, undefined, 'Price and terms agreed in principle; contract with legal.'],
    ['Won', 100, 'won'], ['Lost', 0, 'lost'],
  ] },
  partners: { label: 'Partner organisations (e.g. universities)', kind: 'partners', name: 'Partners', stages: [
    ['First meeting', 10], ['Proposal', 30], ['Agreement in legal', 60], ['Agreement signed', 100, 'won'], ['Not going ahead', 0, 'lost'],
  ] },
  students: { label: 'Students (one person each)', kind: 'people', name: 'Students', stages: [
    ['Enquired', 5], ['Applied', 20], ['Offer', 50], ['Enrolled', 80], ['Fees paid', 100, 'won'], ['Withdrew', 0, 'lost'],
  ] },
};

export async function pipelines(svc: Svc, entityId: string, includeArchived = false) {
  let q = svc.from('crm_pipelines').select('id, entity_id, name, kind, sort, archived_at, crm_stages(id, pipeline_id, name, sort, kind, chance, exit_criteria, cold_after_days)').eq('entity_id', entityId).order('sort');
  if (!includeArchived) q = q.is('archived_at', null);
  const { data } = await q;
  return ((data ?? []) as unknown as (Omit<Pipeline, 'stages'> & { crm_stages: Stage[] })[]).map(({ crm_stages, ...p }) => ({ ...p, stages: [...crm_stages].sort((a, b) => a.sort - b.sort) }));
}

export async function addPipeline(svc: Svc, entityId: string, template: keyof typeof TEMPLATES, name?: string) {
  const t = TEMPLATES[template];
  const { count } = await svc.from('crm_pipelines').select('id', { count: 'exact', head: true }).eq('entity_id', entityId);
  const { data: p } = await svc.from('crm_pipelines').insert({ entity_id: entityId, name: (name || t.name).slice(0, 100), kind: t.kind, sort: count ?? 0 }).select('id').single().throwOnError();
  await svc.from('crm_stages').insert(t.stages.map(([n, chance, kind, exit], i) => ({ pipeline_id: p!.id, name: n, sort: i, chance, kind: kind ?? 'open', exit_criteria: exit ?? '' }))).throwOnError();
  return p!.id as string;
}

/** A venture's first visit: the B2B pipeline, so there is something to work with. */
export async function ensurePipeline(svc: Svc, entityId: string) {
  const list = await pipelines(svc, entityId);
  if (list.length) return list;
  await addPipeline(svc, entityId, 'b2b');
  return pipelines(svc, entityId);
}

// ---------------------------------------------------------------------------
// People and companies (one record for the group)
// ---------------------------------------------------------------------------

/** Email providers whose domain says nothing about the company. */
const FREEMAIL = new Set(['gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'live.com', 'msn.com', 'yahoo.com', 'yahoo.com.au', 'icloud.com', 'me.com', 'mac.com', 'aol.com', 'proton.me', 'protonmail.com', 'bigpond.com', 'bigpond.net.au', 'optusnet.com.au', 'gmx.com', 'gmx.net', 'libero.it', 'virgilio.it', 'tiscali.it', 'qq.com', '163.com', 'yandex.com', 'mail.com', 'zoho.com', 'fastmail.com']);
export const cleanEmail = (e: string) => e.trim().toLowerCase().replace(/^mailto:/, '');
export const validEmail = (e: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e);
/** The company domain an email address points to, unless it is a personal mailbox. */
export const companyDomainOf = (email: string | null | undefined) => {
  const d = (email ?? '').split('@')[1]?.toLowerCase().trim();
  return d && !FREEMAIL.has(d) ? d : null;
};
/** harbourlogistics.com from "https://www.harbourlogistics.com/about". */
export const cleanDomain = (v: string) => v.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/[/?#].*$/, '').replace(/[^a-z0-9.-]/g, '') || null;

export async function findOrCreateCompany(svc: Svc, c: { name: string; domain?: string | null; country?: string; source?: string; createdBy?: string | null; external?: Record<string, string> }) {
  const domain = c.domain ? cleanDomain(c.domain) : null;
  if (domain) {
    const { data } = await svc.from('crm_companies').select('id').eq('domain', domain).is('merged_into', null).maybeSingle();
    if (data) return { id: data.id as string, created: false };
  }
  if (c.name) {
    const { data } = await svc.from('crm_companies').select('id, domain').ilike('name', c.name.replace(/[%_]/g, '\\$&')).is('merged_into', null).limit(1).maybeSingle();
    if (data && (!domain || !data.domain)) {
      if (domain && !data.domain) await svc.from('crm_companies').update({ domain }).eq('id', data.id);
      return { id: data.id as string, created: false };
    }
  }
  const { data } = await svc.from('crm_companies').insert({ name: (c.name || domain || 'Unnamed').slice(0, 200), domain, country: c.country ?? '', source: c.source ?? 'manual', external_ids: c.external ?? {}, created_by: c.createdBy ?? null }).select('id').single().throwOnError();
  return { id: data!.id as string, created: true };
}

/** The person with this email (or a new record); fills in what was empty, never overwrites. */
export async function findOrCreatePerson(svc: Svc, p: { full_name: string; email?: string | null; phone?: string; job_title?: string; company_id?: string | null; source?: string; createdBy?: string | null; external?: Record<string, string> }) {
  const email = p.email ? cleanEmail(p.email) : null;
  if (email && validEmail(email)) {
    const { data } = await svc.from('crm_people').select('id, full_name, phone, job_title, company_id').or(`email.eq.${email},other_emails.cs.{${email}}`).is('merged_into', null).limit(1).maybeSingle();
    if (data) {
      const fill: Record<string, unknown> = {};
      if (!data.phone && p.phone) fill.phone = p.phone;
      if (!data.job_title && p.job_title) fill.job_title = p.job_title;
      if (!data.company_id && p.company_id) fill.company_id = p.company_id;
      if (Object.keys(fill).length) await svc.from('crm_people').update({ ...fill, updated_at: new Date().toISOString() }).eq('id', data.id);
      return { id: data.id as string, created: false };
    }
  }
  // Their portal account, when the address is one (an investor or staff member).
  const { data: profile } = email ? await svc.from('profiles').select('id').eq('email', email).maybeSingle() : { data: null };
  const { data } = await svc.from('crm_people').insert({
    full_name: (p.full_name || email || 'Unnamed').slice(0, 200), email: email && validEmail(email) ? email : null, phone: p.phone ?? '', job_title: p.job_title ?? '',
    company_id: p.company_id ?? null, profile_id: profile?.id ?? null, source: p.source ?? 'manual', external_ids: p.external ?? {}, created_by: p.createdBy ?? null,
  }).select('id').single().throwOnError();
  return { id: data!.id as string, created: true };
}

/** This venture's tie to a person or company (made on first use). */
export async function ensureRelationship(svc: Svc, entityId: string, who: { person_id?: string; company_id?: string }, opts: { kind?: string; owner_id?: string | null; createdBy?: string | null } = {}) {
  const col = who.person_id ? 'person_id' : 'company_id';
  const id = who.person_id ?? who.company_id!;
  const { data } = await svc.from('crm_relationships').select('id, kind, owner_id').eq('entity_id', entityId).eq(col, id).maybeSingle();
  if (data) {
    // A lead becomes a customer, never the other way round by itself.
    const upgrade = opts.kind && ORDER.indexOf(opts.kind) > ORDER.indexOf(data.kind) ? { kind: opts.kind } : {};
    const owner = !data.owner_id && opts.owner_id ? { owner_id: opts.owner_id } : {};
    if (Object.keys({ ...upgrade, ...owner }).length) await svc.from('crm_relationships').update({ ...upgrade, ...owner, archived_at: null, updated_at: new Date().toISOString() }).eq('id', data.id);
    return data.id as string;
  }
  const { data: r } = await svc.from('crm_relationships').insert({ entity_id: entityId, [col]: id, kind: opts.kind && opts.kind in KINDS ? opts.kind : 'lead', owner_id: opts.owner_id ?? null, created_by: opts.createdBy ?? null }).select('id').single().throwOnError();
  return r!.id as string;
}
const ORDER = ['other', 'supplier', 'lead', 'prospect', 'student', 'university', 'partner', 'investor', 'former_customer', 'customer'];

// ---------------------------------------------------------------------------
// Activity, warmth, money
// ---------------------------------------------------------------------------

export async function logActivity(svc: Svc, a: { entity_id: string; kind: Activity['kind']; direction?: 'in' | 'out' | null; subject?: string; body?: string; deal_id?: string | null; person_id?: string | null; company_id?: string | null; source_ref?: string | null; meta?: Record<string, unknown>; occurred_at?: string; created_by?: string | null }) {
  const row = { direction: null, subject: '', body: '', meta: {}, ...a, subject: (a.subject ?? '').slice(0, 300), body: (a.body ?? '').slice(0, 20_000) };
  const { data, error } = await svc.from('crm_activities').insert(row).select('id').maybeSingle();
  // Already filed (the same email or meeting seen twice).
  if (error && error.code === '23505') return null;
  if (error) throw error;
  const at = a.occurred_at ?? new Date().toISOString();
  if (a.deal_id) await svc.from('crm_deals').update({ last_activity_at: at }).eq('id', a.deal_id).or(`last_activity_at.is.null,last_activity_at.lt.${at}`);
  // Contact with a person or company (not our own notes) warms the relationship.
  if (['email', 'meeting', 'call', 'whatsapp', 'room', 'form'].includes(a.kind)) {
    for (const [col, id] of [['person_id', a.person_id], ['company_id', a.company_id]] as const) {
      if (id) await svc.from('crm_relationships').update({ last_contact_at: at }).eq('entity_id', a.entity_id).eq(col, id).or(`last_contact_at.is.null,last_contact_at.lt.${at}`);
    }
  }
  return data?.id as string | undefined;
}

/** How warm a relationship is from its last contact: 100 today, half after three weeks, cold after three months. */
export function warmth(lastContactAt: string | null, now = Date.now()) {
  if (!lastContactAt) return 0;
  const days = Math.max(0, (now - Date.parse(lastContactAt)) / 86_400_000);
  return Math.max(0, Math.min(100, Math.round(100 * Math.exp(-days / 30))));
}
export const warmthLabel = (w: number) => (w >= 70 ? 'Warm' : w >= 35 ? 'Cooling' : w > 0 ? 'Cold' : 'No contact yet');

const fmts = new Map<string, Intl.NumberFormat>();
/** A$86,000 / CA$95,000 / €72,000 (the currency always shown, since deals mix them). */
export function money(amount: number, currency = 'AUD', precise = false) {
  const key = `${currency}${precise}`;
  if (!fmts.has(key)) fmts.set(key, new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: precise ? 2 : 0, minimumFractionDigits: precise ? 2 : 0 }));
  return fmts.get(key)!.format(amount);
}
/** A$402k for column totals. */
export function moneyShort(amount: number, currency = 'AUD') {
  if (Math.abs(amount) < 10_000) return money(amount, currency);
  const sym = money(0, currency).replace(/[\d.,\s]/g, '');
  return Math.abs(amount) >= 1_000_000 ? `${sym}${(amount / 1_000_000).toFixed(1)}m` : `${sym}${Math.round(amount / 1000)}k`;
}

/** Days since a moment (whole days, Sydney-agnostic). */
export const daysSince = (iso: string | null, now = Date.now()) => (iso ? Math.floor((now - Date.parse(iso)) / 86_400_000) : null);
/** Going cold: an open deal with no activity (or stage change) for longer than its stage allows. */
export function goingCold(d: Pick<Deal, 'status' | 'last_activity_at' | 'stage_changed_at' | 'created_at'>, stage: Pick<Stage, 'cold_after_days'> | undefined, now = Date.now()) {
  if (d.status !== 'open' || !stage) return false;
  const last = [d.last_activity_at, d.stage_changed_at, d.created_at].filter(Boolean).sort().pop()!;
  return (daysSince(last, now) ?? 0) > stage.cold_after_days;
}

export const todayIso = (tz = 'Australia/Sydney') => new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date());

/** People's names for owner ids (profiles). */
export async function namesOf(svc: Svc, ids: (string | null | undefined)[]) {
  const list = [...new Set(ids.filter(Boolean) as string[])];
  if (!list.length) return new Map<string, string>();
  const { data } = await svc.from('profiles').select('id, first_name, last_name, email').in('id', list);
  return new Map((data ?? []).map((p) => [p.id as string, `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim() || (p.email as string) || 'Someone']));
}
export const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('') || '?';

/** Custom field values from a form (fields[key]), checked against their type. */
export function readFields(form: FormData, fields: Field[]) {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    const v = String(form.get(`field_${f.key}`) ?? '').trim();
    if (f.type === 'yes_no') { out[f.key] = v === 'yes'; continue; }
    if (!v) continue;
    if (f.type === 'number') { const n = Number(v.replace(/[, ]/g, '')); if (Number.isFinite(n)) out[f.key] = n; }
    else if (f.type === 'date') { if (/^\d{4}-\d{2}-\d{2}$/.test(v)) out[f.key] = v; }
    else if (f.type === 'choice') { if (f.choices.includes(v)) out[f.key] = v; }
    else out[f.key] = v.slice(0, 1000);
  }
  return out;
}

export async function fieldsOf(svc: Svc, entityId: string, appliesTo: Field['applies_to']) {
  const { data } = await svc.from('crm_fields').select('*').eq('entity_id', entityId).eq('applies_to', appliesTo).order('sort');
  return (data ?? []) as Field[];
}

export const crmHref = (scope: Pick<CrmScope, 'companies' | 'current'>, href: string) =>
  scope.current && scope.companies.length > 1 ? `${href}${href.includes('?') ? '&' : '?'}company=${scope.current.code}` : href;

/** An amount in the CRM's own currency (the company's exchange rates, CRM → Settings). */
export function toBase(amount: number, currency: string, company: { crm_currency: string; crm_fx?: Record<string, number> | null }) {
  if (currency === company.crm_currency) return amount;
  const rate = Number(company.crm_fx?.[currency]);
  return Number.isFinite(rate) && rate > 0 ? amount * rate : amount;
}
