import Papa from 'papaparse';
import type { Access } from './access';
import type { serviceClient } from './admin';
import { approverIds } from './approvals';
import { notifyMembers } from './notify';
import { todayIn } from './hr';
import type { SalesInvoice } from './integrations/xero';

// Commissions (Admin → Finance → Commissions, My HR → My commissions; docs/kpi-plan.md). A plan pays reps on the
// invoices raised for the clients credited to them (attribution), by marginal tiers of their period target. A run
// takes a company's invoices for a period (from Xero, or an uploaded CSV), credits them by attribution, works
// out each rep's commission, lists the invoices nobody is credited with, and once Finance approves it, each rep
// sees their statement in My HR and the `sales_attributed` KPIs are filled in.

type Svc = ReturnType<typeof serviceClient>;

export type Tier = { upTo: number | null; rate: number };
export type Plan = { id: string; entity_id: string; name: string; basis: 'invoice_raised'; tiers: Tier[]; cap: number | null; clawback: boolean; active: boolean; notes: string };
export type Assignment = { id: string; plan_id: string; person_id: string; target: number; starts_on: string; ends_on: string | null };
export type Attribution = { id: string; entity_id: string; xero_contact_id: string | null; contact_name: string; person_id: string; share: number; starts_on: string; ends_on: string | null };
export type RunStatus = 'draft' | 'approved' | 'paid';
/** An earlier run's invoice as it is now: its status and amount ex GST (0 once voided). */
export type EarlierStatus = { invoice_id: string; status: string; amount: number };
export type Run = {
  id: string; entity_id: string; plan_id: string | null; period_start: string; period_end: string; status: RunStatus; source: 'xero' | 'upload';
  invoices: SalesInvoice[]; earlier: EarlierStatus[]; upload_name: string | null; fetched_at: string | null; built_by: string | null; built_at: string | null;
  submitted_by: string | null; submitted_at: string | null; approved_by: string | null; approved_at: string | null; paid_by: string | null; paid_at: string | null; notes: string; created_at: string;
};
export type Line = {
  id?: string; run_id?: string; person_id: string | null; plan_id: string | null; kind: 'earned' | 'clawback'; invoice_id: string; invoice_number: string; contact_id: string | null;
  contact_name: string; invoice_date: string; amount: number; share: number; credited: number; rate: number; commission: number; note: string; sort: number;
};

export const RUN_STATES: Record<RunStatus, string> = { draft: 'Draft', approved: 'Approved', paid: 'Paid' };
export const SOURCES = { xero: 'Xero', upload: 'CSV upload' } as const;
export const PLAN_COLUMNS = 'id, entity_id, name, basis, tiers, cap, clawback, active, notes';
export const ASSIGNMENT_COLUMNS = 'id, plan_id, person_id, target, starts_on, ends_on';
export const ATTRIBUTION_COLUMNS = 'id, entity_id, xero_contact_id, contact_name, person_id, share, starts_on, ends_on';
export const RUN_COLUMNS = 'id, entity_id, plan_id, period_start, period_end, status, source, invoices, earlier, upload_name, fetched_at, built_by, built_at, submitted_by, submitted_at, approved_by, approved_at, paid_by, paid_at, notes, created_at';
export const LINE_COLUMNS = 'id, run_id, person_id, plan_id, kind, invoice_id, invoice_number, contact_id, contact_name, invoice_date, amount, share, credited, rate, commission, note, sort';
export const DEFAULT_TIERS: Tier[] = [{ upTo: 100, rate: 8 }, { upTo: null, rate: 12 }];

const NONE = '00000000-0000-0000-0000-000000000000';
const ids = (list: string[]) => (list.length ? list : [NONE]);
/** Every row of a query, a thousand at a time (the API returns at most 1,000 per request). */
export async function allRows<T>(make: () => { range: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: unknown }> }): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await make().range(from, from + 999);
    if (error) throw new Error('The lines could not be read.');
    out.push(...((data ?? []) as T[]));
    if (!data || data.length < 1000) return out;
  }
}
export const cents = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
/** A$1,234.56 (negative: −A$1,234.56). */
export const money = (n: number | null | undefined) => (n == null || !Number.isFinite(Number(n)) ? '—' : `${Number(n) < 0 ? '−' : ''}A$${new Intl.NumberFormat('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Math.abs(Number(n)))}`);
export const rateText = (r: number) => `${new Intl.NumberFormat('en-AU', { maximumFractionDigits: 2 }).format(r)}%`;
const inRange = (d: string, from: string, to: string | null) => d >= from && (!to || d <= to);
const overlaps = (aFrom: string, aTo: string | null, bFrom: string, bTo: string | null) => aFrom <= (bTo ?? '9999-12-31') && bFrom <= (aTo ?? '9999-12-31');
/** How names are compared (CSV invoices, typed contacts): case, spaces and punctuation don't matter. */
export const nameKey = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

// ---------------------------------------------------------------------------
// Tiers
// ---------------------------------------------------------------------------
/** "8% up to 100% of target, then 12%". */
export function tiersText(tiers: Tier[]) {
  return tiers.map((t, i) => `${rateText(t.rate)} ${t.upTo == null ? (i ? 'above that' : 'on everything') : `${i ? `from ${tiers[i - 1].upTo}% ` : ''}up to ${t.upTo}% of target`}`).join(', then ');
}

/** What is wrong with a plan's tiers (empty: fine). The last tier has no upper limit; limits go up. */
export function tierProblems(tiers: Tier[]) {
  const out: string[] = [];
  if (!tiers.length) out.push('Give at least one tier.');
  if (tiers.some((t) => !(t.rate >= 0 && t.rate <= 100))) out.push('A rate is between 0% and 100%.');
  if (tiers.length && tiers.at(-1)!.upTo != null) out.push('Leave the last tier’s “up to” empty: it covers everything above.');
  if (tiers.slice(0, -1).some((t) => t.upTo == null || t.upTo <= 0)) out.push('Every tier but the last needs its “up to” (% of target).');
  if (tiers.slice(0, -1).some((t, i) => i > 0 && t.upTo != null && tiers[i - 1].upTo != null && t.upTo <= tiers[i - 1].upTo!)) out.push('Each tier’s “up to” must be higher than the one before.');
  return out;
}

/** Tiers typed in the plan form (rate_0, upto_0, rate_1…); empty rows are left out. */
export function tiersFrom(form: FormData, read: (s: string) => number | null) {
  const out: Tier[] = [];
  for (let i = 0; i < 6; i++) {
    const rate = read(String(form.get(`rate_${i}`) ?? ''));
    if (rate == null) continue;
    out.push({ rate, upTo: read(String(form.get(`upto_${i}`) ?? '')) });
  }
  return out;
}

/**
 * Commission on credited revenue by marginal tiers of the target: with 8% up to 100% and 12% above, a rep with a
 * A$100,000 target and A$130,000 credited earns 8% of 100,000 plus 12% of 30,000. The amounts are given one by
 * one (invoice lines, in date order) and each gets its own part, so the lines add up to the total; a line that
 * crosses a tier gets a blended rate. The cap, when set, scales every line down so the total is the cap.
 */
export function allocate(amounts: number[], target: number, tiers: Tier[], cap: number | null) {
  const bands = tiers.map((t, i) => ({ from: i ? (tiers[i - 1].upTo ?? Infinity) / 100 * target : 0, to: t.upTo == null ? Infinity : (t.upTo / 100) * target, rate: t.rate / 100 }));
  let done = 0;
  const raw = amounts.map((a) => {
    let c = 0;
    const start = done, end = done + Math.max(0, a);
    for (const b of bands) c += Math.max(0, Math.min(end, b.to) - Math.max(start, b.from)) * b.rate;
    done = end;
    return c;
  });
  const total = raw.reduce((s, c) => s + c, 0);
  const factor = cap != null && total > cap ? (total ? cap / total : 0) : 1;
  const out = raw.map((c) => cents(c * factor));
  // Rounding: the lines still add up to the capped total.
  if (factor < 1 && out.length) out[out.length - 1] = cents(out.at(-1)! + cents(cap!) - cents(out.reduce((s, c) => s + c, 0)));
  return { commissions: out, capped: factor < 1, total: cents(out.reduce((s, c) => s + c, 0)) };
}

// ---------------------------------------------------------------------------
// Attribution
// ---------------------------------------------------------------------------
/** Whether an attribution is for this invoice's client: the same Xero contact, or (no contact id on either side) the same name. */
export const sameClient = (a: Pick<Attribution, 'xero_contact_id' | 'contact_name'>, inv: { contact_id: string | null; contact_name: string }) =>
  a.xero_contact_id && inv.contact_id ? a.xero_contact_id === inv.contact_id : nameKey(a.contact_name) === nameKey(inv.contact_name);
/** The client a row is for (to group a contact's splits). */
export const clientKey = (a: Pick<Attribution, 'xero_contact_id' | 'contact_name'>) => a.xero_contact_id ? `x:${a.xero_contact_id}` : `n:${nameKey(a.contact_name)}`;

/** Who is credited with an invoice, on its date. */
export const creditedOn = (attrs: Attribution[], inv: { contact_id: string | null; contact_name: string; date: string }) =>
  attrs.filter((a) => sameClient(a, inv) && inRange(inv.date, a.starts_on, a.ends_on));

/** Dates where a client's shares don't add up to 100 (empty: fine). Checked on every day a share starts or ends. */
export function splitProblems(rows: Pick<Attribution, 'share' | 'starts_on' | 'ends_on'>[]) {
  const days = new Set<string>();
  for (const r of rows) { days.add(r.starts_on); if (r.ends_on) days.add(r.ends_on); }
  const out: string[] = [];
  for (const d of [...days].sort()) {
    const on = rows.filter((r) => inRange(d, r.starts_on, r.ends_on));
    const total = on.reduce((s, r) => s + Number(r.share), 0);
    if (on.length && Math.abs(total - 100) > 0.001) out.push(`On ${d} the shares add up to ${cents(total)}%, not 100%.`);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Building a run
// ---------------------------------------------------------------------------
export type EarlierLine = Pick<Line, 'person_id' | 'plan_id' | 'kind' | 'invoice_id' | 'invoice_number' | 'contact_id' | 'contact_name' | 'invoice_date' | 'amount' | 'share' | 'credited' | 'rate' | 'commission'>;

/**
 * A run's lines, from:
 *  - the period's invoices: each credited to the people attributed to its client on its date (their share). People
 *    on a plan then (for a run of one plan: that plan) earn by its tiers on their target; people on no plan get the
 *    line without commission (all-plans runs only). Invoices nobody is credited with are lines without a person.
 *  - clawback: invoices in earlier approved runs that are now voided or credited. For plans with clawback on, the
 *    commission paid on the part that's gone is taken back (less what earlier runs already took back), at the rate
 *    it earned. Clawback lines aren't tiered or capped.
 */
export function buildLines(o: {
  invoices: SalesInvoice[]; earlierLines: EarlierLine[]; earlier: EarlierStatus[]; attributions: Attribution[];
  assignments: Assignment[]; plans: Plan[]; planId: string | null;
}): Line[] {
  const planOf = new Map(o.plans.map((p) => [p.id, p]));
  const lines: Line[] = [];
  const earned = new Map<string, { a: Assignment; lines: Line[] }>();
  const invoices = [...o.invoices].filter((v) => v.amount > 0).sort((a, b) => a.date.localeCompare(b.date) || a.number.localeCompare(b.number, 'en', { numeric: true }));
  for (const inv of invoices) {
    const base = { kind: 'earned' as const, invoice_id: inv.id, invoice_number: inv.number, contact_id: inv.contact_id, contact_name: inv.contact_name, invoice_date: inv.date, amount: cents(inv.amount), rate: 0, commission: 0, sort: 0 };
    const who = creditedOn(o.attributions, inv);
    if (!who.length) { lines.push({ ...base, person_id: null, plan_id: null, share: 100, credited: cents(inv.amount), note: inv.note }); continue; }
    for (const w of who) {
      const a = o.assignments.find((x) => x.person_id === w.person_id && inRange(inv.date, x.starts_on, x.ends_on) && planOf.get(x.plan_id) && (!o.planId || x.plan_id === o.planId));
      if (!a && o.planId) continue;
      const line: Line = { ...base, person_id: w.person_id, plan_id: a?.plan_id ?? null, share: Number(w.share), credited: cents(inv.amount * Number(w.share) / 100), note: [inv.note, a ? '' : 'not on a commission plan on that date'].filter(Boolean).join('; ') };
      lines.push(line);
      if (a) earned.set(a.id, { a, lines: [...(earned.get(a.id)?.lines ?? []), line] });
    }
  }
  for (const { a, lines: mine } of earned.values()) {
    const plan = planOf.get(a.plan_id)!;
    const { commissions, capped } = allocate(mine.map((l) => l.credited), Number(a.target), plan.tiers, plan.cap == null ? null : Number(plan.cap));
    mine.forEach((l, i) => {
      l.commission = commissions[i];
      l.rate = l.credited ? Math.round((commissions[i] / l.credited) * 1e6) / 1e4 : 0;
      if (capped) l.note = [l.note, 'capped'].filter(Boolean).join('; ');
    });
  }
  // Clawback, per earlier invoice and person.
  const now = new Map(o.earlier.map((e) => [e.invoice_id, e]));
  const groups = new Map<string, EarlierLine[]>();
  for (const l of o.earlierLines) {
    if (!l.person_id || !now.has(l.invoice_id)) continue;
    if (o.planId && l.plan_id !== o.planId) continue;
    const k = `${l.invoice_id}|${l.person_id}`;
    groups.set(k, [...(groups.get(k) ?? []), l]);
  }
  for (const list of groups.values()) {
    const first = list.find((l) => l.kind === 'earned');
    if (!first || !Number(first.commission)) continue;
    const plan = first.plan_id ? planOf.get(first.plan_id) : null;
    if (plan && !plan.clawback) continue;
    const e = now.get(first.invoice_id)!;
    const original = Number(first.amount);
    const gone = ['VOIDED', 'DELETED'].includes(e.status) ? 1 : original > 0 ? Math.min(1, Math.max(0, 1 - Number(e.amount) / original)) : 0;
    const taken = -list.filter((l) => l.kind === 'clawback').reduce((s, l) => s + Number(l.commission), 0);
    const takenAmount = -list.filter((l) => l.kind === 'clawback').reduce((s, l) => s + Number(l.amount), 0);
    const due = cents(Number(first.commission) * gone - taken);
    if (due < 0.01) continue;
    const amount = -cents(original * gone - takenAmount);
    lines.push({
      person_id: first.person_id, plan_id: first.plan_id, kind: 'clawback', invoice_id: first.invoice_id, invoice_number: first.invoice_number, contact_id: first.contact_id, contact_name: first.contact_name,
      invoice_date: first.invoice_date, amount, share: Number(first.share), credited: cents(amount * Number(first.share) / 100), rate: Number(first.rate), commission: -due, sort: 0,
      note: ['VOIDED', 'DELETED'].includes(e.status) ? `${e.status.toLowerCase()} after its run was approved` : `credited after its run was approved (now ${money(e.amount)} ex GST)`,
    });
  }
  return lines.map((l, i) => ({ ...l, sort: i }));
}

export type RepTotal = { person_id: string; plan_id: string | null; target: number | null; credited: number; clawedBack: number; attainment: number | null; earned: number; clawback: number; commission: number; lines: number };

/** Per rep: revenue credited in the run, % of target, commission earned, taken back and in all. */
export function repTotals(lines: Line[], assignments: Assignment[], run: Pick<Run, 'period_start' | 'period_end' | 'plan_id'>) {
  const out = new Map<string, RepTotal>();
  const inForce = (personId: string) => assignments.filter((a) => a.person_id === personId && overlaps(a.starts_on, a.ends_on, run.period_start, run.period_end) && (!run.plan_id || a.plan_id === run.plan_id));
  // Everyone on a plan for the period is listed, with or without sales.
  for (const a of assignments.filter((x) => overlaps(x.starts_on, x.ends_on, run.period_start, run.period_end) && (!run.plan_id || x.plan_id === run.plan_id))) {
    if (!out.has(a.person_id)) out.set(a.person_id, { person_id: a.person_id, plan_id: a.plan_id, target: Number(a.target), credited: 0, clawedBack: 0, attainment: null, earned: 0, clawback: 0, commission: 0, lines: 0 });
  }
  for (const l of lines) {
    if (!l.person_id) continue;
    const t = out.get(l.person_id) ?? { person_id: l.person_id, plan_id: l.plan_id, target: inForce(l.person_id)[0] ? Number(inForce(l.person_id)[0].target) : null, credited: 0, clawedBack: 0, attainment: null, earned: 0, clawback: 0, commission: 0, lines: 0 };
    if (l.kind === 'earned') { t.credited = cents(t.credited + Number(l.credited)); t.earned = cents(t.earned + Number(l.commission)); }
    else { t.clawedBack = cents(t.clawedBack + Number(l.credited)); t.clawback = cents(t.clawback + Number(l.commission)); }
    t.commission = cents(t.earned + t.clawback);
    t.lines++;
    out.set(l.person_id, t);
  }
  for (const t of out.values()) t.attainment = t.target ? t.credited / t.target : null;
  return [...out.values()];
}

// ---------------------------------------------------------------------------
// CSV invoices (companies without Xero)
// ---------------------------------------------------------------------------
const HEADERS: Record<string, RegExp> = {
  number: /^(invoice\s*(number|no\.?|#)|number|invoice)$/i,
  contact: /^(contact|client|customer|contact\s*name|client\s*name|customer\s*name)$/i,
  date: /^(date|invoice\s*date)$/i,
  amount: /^(amount|amount\s*ex(cl(uding)?)?\.?\s*gst|subtotal|sub\s*total|net|ex\s*gst)$/i,
  status: /^status$/i,
};
/** 2026-10-30, 30/10/2026 or 30/10/26 (Australian order). */
function csvDate(s: string) {
  const t = s.trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(t)) return t.slice(0, 10);
  const m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/.exec(t);
  if (!m) return '';
  const y = m[3].length === 2 ? `20${m[3]}` : m[3];
  const d = `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return Number.isNaN(Date.parse(d)) ? '' : d;
}

/**
 * Invoices from a CSV: columns invoice number, contact, date and amount excluding GST (headers in any order; without
 * headers, in that order), and optionally status. A row with status VOIDED is an earlier invoice that was voided
 * (for clawback), not a sale. Rows outside the period, without an amount above zero, or unreadable are skipped.
 */
export function invoicesFromCsv(text: string, period: { start: string; end: string }) {
  const rows = (Papa.parse<string[]>(text.replace(/^﻿/, ''), { skipEmptyLines: true }).data ?? []).map((r) => r.map((c) => String(c ?? '').trim()));
  if (!rows.length) throw new Error('The file is empty.');
  const head = rows[0];
  const col: Record<string, number> = {};
  for (const [k, re] of Object.entries(HEADERS)) { const i = head.findIndex((h) => re.test(h)); if (i >= 0) col[k] = i; }
  const headed = col.contact != null && col.date != null && col.amount != null;
  if (!headed) Object.assign(col, { number: 0, contact: 1, date: 2, amount: 3, status: head.length > 4 ? 4 : undefined });
  const invoices: SalesInvoice[] = [], voided: string[] = [];
  const skipped = { outside: 0, unreadable: 0, zero: 0 };
  const seen = new Set<string>();
  for (const [n, r] of rows.slice(headed ? 1 : 0).entries()) {
    const number = r[col.number ?? -1] ?? '', contact = r[col.contact] ?? '', date = csvDate(r[col.date] ?? '');
    const status = (col.status != null ? r[col.status] ?? '' : '').toUpperCase();
    const rawAmount = (r[col.amount] ?? '').replace(/[$,\sA-Za-z]/g, '');
    const amount = /^\(.*\)$/.test(rawAmount) ? -Number(rawAmount.slice(1, -1)) : Number(rawAmount);
    if (status === 'VOIDED' || status === 'DELETED') { if (number) voided.push(number); continue; }
    if (!contact || !date || !Number.isFinite(amount) || !rawAmount) { skipped.unreadable++; continue; }
    if (date < period.start || date > period.end) { skipped.outside++; continue; }
    if (amount <= 0) { skipped.zero++; continue; }
    let id = `csv:${number || `row-${n + 1}`}`;
    while (seen.has(id)) id = `${id}+`;
    seen.add(id);
    invoices.push({ id, number: number.slice(0, 100), contact_id: null, contact_name: contact.slice(0, 300), date, amount: cents(amount), status: 'AUTHORISED', note: '' });
  }
  return { invoices, voided, skipped };
}

// ---------------------------------------------------------------------------
// Loading and saving
// ---------------------------------------------------------------------------
type Company = { id: string; code: string; display_name: string };

/** Companies whose commissions this person sees (Finance: accounting.view; Lakeba's team sees every company in the portal). */
export async function commissionCompanies(svc: Svc, access: Access) {
  const list = access.companies('accounting.view');
  let q = svc.from('entities').select('id, code, display_name').eq('portal', 'full').order('sort');
  if (list !== 'all') q = q.in('id', ids(list));
  return ((await q).data ?? []) as Company[];
}

/** A company's plans, assignments, attribution and current people. */
export async function setupOf(svc: Svc, entityId: string) {
  const [{ data: plans }, { data: people }, { data: attributions }] = await Promise.all([
    svc.from('commission_plans').select(PLAN_COLUMNS).eq('entity_id', entityId).order('name'),
    svc.from('people').select('id, full_name, job_title, user_id, status').eq('entity_id', entityId).order('full_name'),
    svc.from('commission_attributions').select(ATTRIBUTION_COLUMNS).eq('entity_id', entityId).order('contact_name').order('starts_on'),
  ]);
  const planIds = (plans ?? []).map((p) => p.id as string);
  const { data: assignments } = await svc.from('commission_assignments').select(ASSIGNMENT_COLUMNS).in('plan_id', ids(planIds)).order('starts_on');
  return {
    plans: ((plans ?? []) as Plan[]).map((p) => ({ ...p, tiers: (p.tiers ?? []).map((t) => ({ upTo: t.upTo == null ? null : Number(t.upTo), rate: Number(t.rate) })) })),
    people: (people ?? []) as { id: string; full_name: string; job_title: string; user_id: string | null; status: string }[],
    attributions: (attributions ?? []) as Attribution[],
    assignments: (assignments ?? []) as Assignment[],
  };
}

export async function loadRun(svc: Svc, id: string) {
  if (!/^[0-9a-f-]{36}$/.test(id)) return null;
  const { data: run } = await svc.from('commission_runs').select(RUN_COLUMNS).eq('id', id).maybeSingle();
  if (!run) return null;
  const lines = await allRows<Line>(() => svc.from('commission_run_lines').select(LINE_COLUMNS).eq('run_id', id).order('sort'));
  return { ...(run as Run), lines: lines.map((l) => ({ ...l, amount: Number(l.amount), share: Number(l.share), credited: Number(l.credited), rate: Number(l.rate), commission: Number(l.commission) })) };
}

/** Another run of the company that covers the same days for the same plan(s) (runs can't overlap, or invoices would count twice). */
export async function overlappingRun(svc: Svc, r: Pick<Run, 'entity_id' | 'plan_id' | 'period_start' | 'period_end'> & { id?: string }) {
  const { data } = await svc.from('commission_runs').select('id, plan_id, period_start, period_end').eq('entity_id', r.entity_id).lte('period_start', r.period_end).gte('period_end', r.period_start);
  return (data ?? []).find((x) => x.id !== r.id && (!x.plan_id || !r.plan_id || x.plan_id === r.plan_id)) ?? null;
}

/** Lines of the company's earlier approved (or paid) runs, for clawback. */
async function earlierLinesOf(svc: Svc, run: Pick<Run, 'id' | 'entity_id' | 'period_start'>) {
  // A run being made has no id yet.
  let q = svc.from('commission_runs').select('id').eq('entity_id', run.entity_id).in('status', ['approved', 'paid']).lt('period_start', run.period_start);
  if (run.id) q = q.neq('id', run.id);
  const { data: runs, error } = await q;
  if (error) throw new Error('Earlier runs could not be read.');
  const runIds = (runs ?? []).map((r) => r.id as string);
  if (!runIds.length) return [];
  return allRows<EarlierLine>(() => svc.from('commission_run_lines').select('person_id, plan_id, kind, invoice_id, invoice_number, contact_id, contact_name, invoice_date, amount, share, credited, rate, commission').in('run_id', runIds).not('person_id', 'is', null).order('id'));
}

/** The period's invoices and the earlier ones' status, from Xero. */
export async function fetchFromXero(svc: Svc, run: Pick<Run, 'id' | 'entity_id' | 'period_start' | 'period_end'>, company: Company, central: string) {
  const { xeroConnected } = await import('./reporting');
  const c = await xeroConnected(svc, company.id);
  if (!c) throw new Error('Xero isn’t connected for this company: upload a CSV of the invoices instead.');
  const { xeroSalesInvoices, xeroInvoicesById } = await import('./integrations/xero');
  const invoices = await xeroSalesInvoices(svc, c, company, central, { start: run.period_start, end: run.period_end });
  const earlierIds = [...new Set((await earlierLinesOf(svc, run)).filter((l) => l.kind === 'earned' && !l.invoice_id.startsWith('csv:')).map((l) => l.invoice_id))];
  const earlier = (await xeroInvoicesById(svc, c, company, central, earlierIds)).map((v) => ({ invoice_id: v.id, status: v.status, amount: ['VOIDED', 'DELETED'].includes(v.status) ? 0 : v.amount }));
  return { invoices, earlier };
}

/** Earlier CSV invoices named VOIDED in this upload (matched by invoice number). */
export async function voidedFromCsv(svc: Svc, run: Pick<Run, 'id' | 'entity_id' | 'period_start'>, numbers: string[]) {
  if (!numbers.length) return [];
  const want = new Set(numbers.map((n) => n.toLowerCase()));
  const lines = await earlierLinesOf(svc, run);
  return [...new Set(lines.filter((l) => l.kind === 'earned' && want.has(l.invoice_number.toLowerCase())).map((l) => l.invoice_id))].map((id) => ({ invoice_id: id, status: 'VOIDED', amount: 0 }));
}

/**
 * Builds (or rebuilds) a draft run's lines from what it was fetched from (or new invoices), with today's plans,
 * assignments and attribution. Building again takes it back from approval: it has to be sent again.
 */
export async function buildRun(svc: Svc, run: Run, userId: string, fresh?: { invoices: SalesInvoice[]; earlier: EarlierStatus[]; source?: Run['source']; upload_name?: string | null }) {
  if (run.status !== 'draft') throw new Error('Only a draft run can be built again.');
  const invoices = fresh?.invoices ?? run.invoices ?? [];
  const earlier = fresh?.earlier ?? run.earlier ?? [];
  const [setup, earlierLines] = await Promise.all([setupOf(svc, run.entity_id), earlierLinesOf(svc, run)]);
  const lines = buildLines({ invoices, earlier, earlierLines, attributions: setup.attributions, assignments: setup.assignments, plans: setup.plans, planId: run.plan_id });
  const now = new Date().toISOString();
  await svc.from('commission_run_lines').delete().eq('run_id', run.id).throwOnError();
  for (let i = 0; i < lines.length; i += 500) await svc.from('commission_run_lines').insert(lines.slice(i, i + 500).map((l) => ({ ...l, run_id: run.id }))).throwOnError();
  await svc.from('commission_runs').update({
    invoices, earlier, built_by: userId, built_at: now, submitted_by: null, submitted_at: null, updated_at: now,
    ...(fresh ? { fetched_at: now, ...(fresh.source ? { source: fresh.source } : {}), ...(fresh.upload_name !== undefined ? { upload_name: fresh.upload_name } : {}) } : {}),
  }).eq('id', run.id).throwOnError();
  return lines;
}

/** "1 Oct 2026 to 31 Dec 2026", or "October 2026" / "Oct–Dec 2026" for whole months. */
export function periodText(start: string, end: string) {
  const month = (d: string, style: 'long' | 'short') => new Intl.DateTimeFormat('en-AU', { month: style, timeZone: 'UTC' }).format(new Date(`${d}T00:00:00Z`));
  const lastDay = (d: string) => new Date(Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)), 0)).toISOString().slice(0, 10);
  if (start.slice(8) === '01' && end === lastDay(end)) {
    if (start.slice(0, 7) === end.slice(0, 7)) return `${month(start, 'long')} ${start.slice(0, 4)}`;
    return start.slice(0, 4) === end.slice(0, 4) ? `${month(start, 'short')}–${month(end, 'short')} ${end.slice(0, 4)}` : `${month(start, 'short')} ${start.slice(0, 4)} – ${month(end, 'short')} ${end.slice(0, 4)}`;
  }
  const day = (d: string) => new Intl.DateTimeFormat('en-AU', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${d}T00:00:00Z`));
  return `${day(start)} to ${day(end)}`;
}

/** The last full month, quarter or year before today (Sydney), for a new run. */
export function lastPeriod(kind: 'month' | 'quarter' | 'year', today = todayIn()) {
  const y = Number(today.slice(0, 4)), m = Number(today.slice(5, 7));
  const iso = (yy: number, mm: number, dd: number) => new Date(Date.UTC(yy, mm - 1, dd)).toISOString().slice(0, 10);
  if (kind === 'month') return { start: iso(y, m - 1, 1), end: iso(y, m, 0) };
  if (kind === 'year') return { start: iso(y - 1, 1, 1), end: iso(y - 1, 12, 31) };
  const q = Math.floor((m - 1) / 3) * 3 + 1;
  return { start: iso(y, q - 3, 1), end: iso(y, q, 0) };
}

// ---------------------------------------------------------------------------
// Approval: Finance is told, reps are told, the KPIs are filled in
// ---------------------------------------------------------------------------
/** Who may approve a run: Finance with approve, not the person who built or sent it (four eyes). */
export const mayApproveRun = (access: Access, userId: string, run: Pick<Run, 'entity_id' | 'built_by' | 'submitted_by'>) =>
  access.can('accounting.approve', run.entity_id) && userId !== run.built_by && userId !== run.submitted_by;

/** Finance approvers, but not the person sending it. */
export const runApprovers = async (svc: Svc, entityId: string, by: string) => (await approverIds(svc, 'accounting', entityId)).filter((u) => u !== by);

export async function submitRun(svc: Svc, run: Run, company: Company, userId: string, origin: string) {
  const approvers = await runApprovers(svc, run.entity_id, userId);
  if (!approvers.length) throw new Error('Nobody else can approve it yet: give someone a role with Finance “approve” in Settings → Users.');
  const now = new Date().toISOString();
  await svc.from('commission_runs').update({ submitted_by: userId, submitted_at: now, updated_at: now }).eq('id', run.id).eq('status', 'draft').throwOnError();
  await notifyMembers({
    kind: 'reporting', userIds: approvers, origin, link: `/admin/accounting/commissions/${run.id}`,
    title: `${company.display_name}: commission run to approve`, body: `The ${periodText(run.period_start, run.period_end)} commission run for ${company.display_name} is waiting for your approval.`,
  }).catch(() => 0);
  return approvers.length;
}

/**
 * Writes the run's credited revenue into the `sales_attributed` KPIs: for each rep with an active (or in review)
 * scorecard whose period overlaps the run, a confirmed result on each item whose KPI has that source, dated the
 * run's last day (inside the scorecard's period), one per run (approving again refreshes it). Returns how many.
 */
export async function salesToKpis(svc: Svc, run: Pick<Run, 'id' | 'period_start' | 'period_end' | 'plan_id'>, totals: RepTotal[], userId: string) {
  if (!totals.length) return 0;
  const { data: cards } = await svc.from('kpi_scorecards').select('id, person_id, kpi_periods!inner(starts_on, ends_on)').in('person_id', totals.map((t) => t.person_id)).in('status', ['active', 'in_review'])
    .lte('kpi_periods.starts_on', run.period_end).gte('kpi_periods.ends_on', run.period_start);
  const list = (cards ?? []) as unknown as { id: string; person_id: string; kpi_periods: { starts_on: string; ends_on: string } }[];
  if (!list.length) return 0;
  const { data: items } = await svc.from('kpi_scorecard_items').select('id, scorecard_id, kpi_definitions!inner(source)').in('scorecard_id', list.map((c) => c.id)).eq('kpi_definitions.source', 'sales_attributed');
  let n = 0;
  const now = new Date().toISOString();
  for (const item of (items ?? []) as unknown as { id: string; scorecard_id: string }[]) {
    const card = list.find((c) => c.id === item.scorecard_id)!;
    const t = totals.find((x) => x.person_id === card.person_id)!;
    const p = card.kpi_periods;
    const asOf = run.period_end > p.ends_on ? p.ends_on : run.period_end < p.starts_on ? p.starts_on : run.period_end;
    const row = { value: t.credited, as_of: asOf, note: `Commission run ${periodText(run.period_start, run.period_end)}: revenue credited, excluding GST.`, status: 'confirmed', confirmed_by: userId, confirmed_at: now, updated_at: now };
    const { data: old } = await svc.from('kpi_results').select('id').eq('item_id', item.id).eq('source', 'sales_attributed').eq('source_ref', run.id).maybeSingle();
    if (old) await svc.from('kpi_results').update(row).eq('id', old.id).throwOnError();
    else await svc.from('kpi_results').insert({ ...row, item_id: item.id, source: 'sales_attributed', source_ref: run.id, proposed_by: userId, proposed_at: now }).throwOnError();
    n++;
  }
  return n;
}

/** Approves a run: the reps with lines in it (and a portal account) are told, and their sales KPIs filled in. */
export async function approveRun(svc: Svc, run: Run & { lines: Line[] }, company: Company, userId: string, origin: string) {
  const now = new Date().toISOString();
  const { data: done } = await svc.from('commission_runs').update({ status: 'approved', approved_by: userId, approved_at: now, updated_at: now }).eq('id', run.id).eq('status', 'draft').select('id');
  if (!done?.length) throw new Error('It was approved already, or changed: reload the page.');
  const setup = await setupOf(svc, run.entity_id);
  const totals = repTotals(run.lines, setup.assignments, run);
  const kpis = await salesToKpis(svc, run, totals, userId);
  const withLines = [...new Set(run.lines.filter((l) => l.person_id).map((l) => l.person_id!))];
  const { data: reps } = await svc.from('people').select('id, user_id, status').in('id', ids(withLines));
  const told = ((reps ?? []).filter((p) => p.user_id && p.status !== 'left')).map((p) => p.user_id as string);
  if (told.length) {
    await notifyMembers({
      kind: 'my_hr', userIds: told, origin, link: '/my-hr/commissions', entityId: run.entity_id,
      title: `Your commission for ${periodText(run.period_start, run.period_end)}`, body: `${company.display_name} approved the commission run for ${periodText(run.period_start, run.period_end)}. Your statement, invoice by invoice, is in My HR → My commissions.`,
    }).catch(() => 0);
  }
  return { kpis, told: told.length };
}

/** A run's lines as CSV (Finance's export). */
export function linesCsv(lines: Line[], nameOf: (personId: string | null) => string) {
  const rows = [['Rep', 'Kind', 'Invoice', 'Client', 'Invoice date', 'Amount ex GST', 'Share %', 'Credited', 'Rate %', 'Commission', 'Note'],
    ...lines.map((l) => [l.person_id ? nameOf(l.person_id) : 'Not credited to anyone', l.kind === 'earned' ? 'Earned' : 'Clawback', l.invoice_number, l.contact_name, l.invoice_date, l.amount.toFixed(2), String(l.share), l.credited.toFixed(2), String(cents(l.rate)), l.commission.toFixed(2), l.note])];
  return Papa.unparse(rows);
}

// ---------------------------------------------------------------------------
// Saving attribution
// ---------------------------------------------------------------------------
const dayBefore = (d: string) => new Date(Date.parse(`${d}T00:00:00Z`) - 864e5).toISOString().slice(0, 10);
const dayAfter = (d: string) => new Date(Date.parse(`${d}T00:00:00Z`) + 864e5).toISOString().slice(0, 10);

/**
 * Who sold to a client from a date (to a date, or open): the new split replaces whatever the client had for those
 * days; what it had before and after stays. The shares must add up to 100.
 */
export async function saveAttribution(svc: Svc, o: {
  entityId: string; contact: { id: string | null; name: string }; rows: { person_id: string; share: number }[]; starts_on: string; ends_on: string | null; userId: string;
}) {
  if (!o.contact.name.trim()) throw new Error('Choose the client, or type its name.');
  if (!o.rows.length) throw new Error('Choose who is credited.');
  if (new Set(o.rows.map((r) => r.person_id)).size !== o.rows.length) throw new Error('Each person once.');
  if (o.rows.some((r) => !(r.share > 0 && r.share <= 100))) throw new Error('A share is more than 0% and at most 100%.');
  const total = o.rows.reduce((s, r) => s + r.share, 0);
  if (Math.abs(total - 100) > 0.001) throw new Error(`The shares add up to ${cents(total)}%: make them 100%.`);
  if (o.ends_on && o.ends_on < o.starts_on) throw new Error('The end is before the start.');
  const { data: people } = await svc.from('people').select('id').eq('entity_id', o.entityId).in('id', o.rows.map((r) => r.person_id));
  if ((people ?? []).length !== o.rows.length) throw new Error('Choose people from this company.');
  const client = { xero_contact_id: o.contact.id, contact_name: o.contact.name.trim().slice(0, 300) };
  const { data: existing } = await svc.from('commission_attributions').select(ATTRIBUTION_COLUMNS).eq('entity_id', o.entityId);
  const mine = ((existing ?? []) as Attribution[]).filter((a) => clientKey(a) === clientKey(client));
  const end = o.ends_on;
  for (const a of mine) {
    if (!overlaps(a.starts_on, a.ends_on, o.starts_on, end)) continue;
    const before = a.starts_on < o.starts_on;
    const after = end != null && (a.ends_on == null || a.ends_on > end);
    if (!before && !after) { await svc.from('commission_attributions').delete().eq('id', a.id).throwOnError(); continue; }
    if (before) await svc.from('commission_attributions').update({ ends_on: dayBefore(o.starts_on) }).eq('id', a.id).throwOnError();
    if (after) {
      const { id: _id, ...rest } = a;
      if (before) await svc.from('commission_attributions').insert({ ...rest, starts_on: dayAfter(end!), created_by: o.userId }).throwOnError();
      else await svc.from('commission_attributions').update({ starts_on: dayAfter(end!) }).eq('id', a.id).throwOnError();
    }
  }
  await svc.from('commission_attributions').insert(o.rows.map((r) => ({ entity_id: o.entityId, ...client, person_id: r.person_id, share: r.share, starts_on: o.starts_on, ends_on: end, created_by: o.userId }))).throwOnError();
  const { data: after } = await svc.from('commission_attributions').select(ATTRIBUTION_COLUMNS).eq('entity_id', o.entityId);
  return splitProblems(((after ?? []) as Attribution[]).filter((a) => clientKey(a) === clientKey(client)));
}

/** The first day after `from` on which the client already has attribution (so a quick assign stops before it). */
export function nextStart(attrs: Attribution[], client: { contact_id: string | null; contact_name: string }, from: string) {
  const starts = attrs.filter((a) => sameClient(a, client) && a.starts_on > from).map((a) => a.starts_on).sort();
  return starts[0] ? dayBefore(starts[0]) : null;
}
