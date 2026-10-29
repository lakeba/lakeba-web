import { createHash, randomBytes } from 'node:crypto';
import type { Access } from './access';
import type { serviceClient } from './admin';
import { notifyMembers } from './notify';
import { integrationsReady, openJson, sealJson } from './secret-box';

// Legal and company secretary (Admin → Legal), phase 1: company records, the
// officers register and the calendar of what is due. The rules below create
// the calendar's items from the records (annual review, AGM and financial
// report for public companies, ASIC notices after officer changes and share
// issues); people add the rest by hand. The portal reminds and keeps the
// proof; it doesn't lodge anything with ASIC. Deadlines are Australian
// (Corporations Act); every company on the platform is registered in Australia.

type Svc = ReturnType<typeof serviceClient>;

export type LegalCompany = { id: string; code: string; display_name: string; legal_name: string | null; company_number: string | null; country: string | null; relationship: string; sort: number };
export type CompanyRecord = {
  entity_id: string; acn: string | null; abn: string | null; company_type: 'proprietary' | 'public' | null; incorporated_on: string | null;
  registered_in: string | null; registered_office: string | null; principal_place: string | null; year_end: string | null; review_date: string | null;
  auditor: string | null; ultimate_holding: string | null; constitution_document_id: string | null; notes: string; extract_path: string | null; extract_dated: string | null;
  updated_at: string;
};
export type Officer = {
  id: string; entity_id: string; full_name: string; email: string | null; user_id: string | null; position: Position;
  appointed_on: string | null; ceased_on: string | null; consent_on: string | null; consent_path: string | null; private_sealed: string | null; notes: string;
};
export type Obligation = {
  id: string; entity_id: string; kind: Kind; title: string; detail: string; due_on: string; owner_id: string | null; status: 'open' | 'done' | 'not_needed';
  source_key: string | null; done_on: string | null; done_note: string; proof_path: string | null; reminded: string[];
};
/** What ASIC asks for about an officer; kept sealed. */
export type OfficerPrivate = { date_of_birth?: string; place_of_birth?: string; residential_address?: string; director_id?: string };

export const POSITIONS = { director: 'Director', alternate_director: 'Alternate director', secretary: 'Secretary' } as const;
export type Position = keyof typeof POSITIONS;
export const KINDS = {
  annual_review: 'Annual review', solvency: 'Solvency resolution', officer_change: 'Officer change', address_change: 'Address change',
  share_issue: 'Share issue', agm: 'AGM', financial_report: 'Financial report', minutes: 'Minutes', other: 'Other',
} as const;
export type Kind = keyof typeof KINDS;
export const STATES = ['ACT', 'NSW', 'NT', 'QLD', 'SA', 'TAS', 'VIC', 'WA'];
export const RECORD_COLUMNS = 'entity_id, acn, abn, company_type, incorporated_on, registered_in, registered_office, principal_place, year_end, review_date, auditor, ultimate_holding, constitution_document_id, notes, extract_path, extract_dated, updated_at';
export const OFFICER_COLUMNS = 'id, entity_id, full_name, email, user_id, position, appointed_on, ceased_on, consent_on, consent_path, private_sealed, notes';
export const OBLIGATION_COLUMNS = 'id, entity_id, kind, title, detail, due_on, owner_id, status, source_key, done_on, done_note, proof_path, reminded';

/** Every company on the platform (portfolio ones too) that this permission covers. */
export async function legalCompanies(svc: Svc, access: Access, level: 'view' | 'do' = 'view'): Promise<LegalCompany[]> {
  const ids = access.companies(`legal.${level}`);
  let q = svc.from('entities').select('id, code, display_name, legal_name, company_number, country, relationship, sort').order('sort');
  if (ids !== 'all') q = q.in('id', ids.length ? ids : ['00000000-0000-0000-0000-000000000000']);
  return ((await q).data ?? []) as LegalCompany[];
}

// ---------------------------------------------------------------------------
// Dates ('YYYY-MM-DD', counted in Sydney)
// ---------------------------------------------------------------------------
export const todayIn = (now = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Sydney', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
const utc = (d: string) => Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10)));
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
const sydneyParts = (d: Date) => Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Sydney', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(d).map((p) => [p.type, p.value]));
/** A Sydney wall-clock time ('YYYY-MM-DDTHH:mm', as a datetime-local field gives it) as a Date, summer time included. */
export function fromSydney(local: string) {
  const guess = new Date(`${local}:00Z`);
  if (Number.isNaN(guess.getTime())) return null;
  const p = sydneyParts(guess);
  const shown = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute));
  return new Date(guess.getTime() - (shown - guess.getTime()));
}
/** The other way: a time as a datetime-local field's value in Sydney. */
export const toSydney = (iso: string) => { const p = sydneyParts(new Date(iso)); return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`; };
export const addDays = (d: string, n: number) => iso(utc(d) + n * 864e5);
export const daysBetween = (from: string, to: string) => Math.round((utc(to) - utc(from)) / 864e5);
/** Same day n months later, or that month's last day; from a month's last day, to the last day (30 June + 4 months = 31 October, as ASIC counts it). */
export function addMonths(d: string, n: number) {
  const y = Number(d.slice(0, 4)), m = Number(d.slice(5, 7)) - 1 + n, day = Number(d.slice(8, 10));
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const monthEnd = day === new Date(Date.UTC(y, Number(d.slice(5, 7)), 0)).getUTCDate();
  return iso(Date.UTC(y, m, monthEnd ? last : Math.min(day, last)));
}
/** MM-DD in a year (29 Feb → 28 Feb when there is none). */
export function onIn(mmdd: string, year: number) {
  const [m, d] = mmdd.split('-').map(Number);
  const last = new Date(Date.UTC(year, m, 0)).getUTCDate();
  return iso(Date.UTC(year, m - 1, Math.min(d, last)));
}
/** The latest occurrence of MM-DD on or before `d`. */
const lastOn = (mmdd: string, d: string) => { const y = Number(d.slice(0, 4)); const t = onIn(mmdd, y); return t <= d ? t : onIn(mmdd, y - 1); };
export const reviewDateOf = (r: Pick<CompanyRecord, 'review_date' | 'incorporated_on'> | null) => r?.review_date ?? (r?.incorporated_on ? r.incorporated_on.slice(5) : null);
export const yearEndOf = (r: Pick<CompanyRecord, 'year_end'> | null) => r?.year_end ?? '06-30';

/** Items the rules made before the portal knew the company are left out when they were due this long ago. */
const LOOK_BACK_DAYS = 60;

// ---------------------------------------------------------------------------
// The rules
// ---------------------------------------------------------------------------
type Rule = { entity_id: string; kind: Kind; title: string; detail: string; due_on: string; source_key: string };

/** What the records say is due, for these companies. */
export async function ruleItems(svc: Svc, entityIds: string[], today = todayIn()): Promise<Rule[]> {
  if (!entityIds.length) return [];
  const since = addDays(today, -LOOK_BACK_DAYS);
  const [{ data: entities }, { data: records }, { data: officers }, { data: issues }] = await Promise.all([
    svc.from('entities').select('id, display_name, country').in('id', entityIds),
    svc.from('company_records').select(RECORD_COLUMNS).in('entity_id', entityIds),
    svc.from('company_officers').select('id, entity_id, full_name, position, appointed_on, ceased_on').in('entity_id', entityIds).or(`appointed_on.gte.${since},ceased_on.gte.${since}`),
    svc.from('register_movements').select('entity_id, moved_on, shares, holder_id').in('entity_id', entityIds).in('kind', ['Allotment', 'Subscription']).gte('moved_on', since),
  ]);
  const out: Rule[] = [];
  const name = new Map((entities ?? []).map((e) => [e.id, e.display_name as string]));
  const australian = new Set((entities ?? []).filter((e) => !e.country || /australia/i.test(e.country)).map((e) => e.id));
  const fresh = (due: string) => due >= since;

  for (const r of (records ?? []) as CompanyRecord[]) {
    if (!australian.has(r.entity_id)) continue;
    const review = reviewDateOf(r);
    // The current annual review: the latest one still being dealt with, else the next one.
    if (review) {
      let next = lastOn(review, today);
      if (!fresh(addMonths(next, 2))) next = onIn(review, Number(next.slice(0, 4)) + 1);
      const firstReview = r.incorporated_on ? addMonths(r.incorporated_on, 12) : null;
      const due = addMonths(next, 2);
      if ((!firstReview || next >= firstReview) && fresh(due)) {
        out.push({ entity_id: r.entity_id, kind: 'annual_review', source_key: `annual_review:${r.entity_id}:${next}`, due_on: due,
          title: `Annual review ${next.slice(0, 4)}: check the company statement and pay the ASIC fee`,
          detail: `ASIC issues the annual company statement on the review date (${next}). Check it within 28 days and tell ASIC about anything wrong; pay the annual review fee within two months.` });
        if (r.company_type !== 'public') out.push({ entity_id: r.entity_id, kind: 'solvency', source_key: `solvency:${r.entity_id}:${next}`, due_on: due,
          title: `Solvency resolution for the ${next.slice(0, 4)} annual review`,
          detail: 'Within two months of the review date the directors pass a solvency resolution, unless the company lodges a negative solvency statement with ASIC. File the signed resolution as the proof.' });
      }
    }
    if (r.company_type === 'public') {
      // For each, the latest year end still being dealt with, else the next one.
      const ye = yearEndOf(r), last = lastOn(ye, today);
      const yearEnd = (months: number) => (fresh(addMonths(last, months)) ? last : onIn(ye, Number(last.slice(0, 4)) + 1));
      const fr = yearEnd(4), ag = yearEnd(5);
      out.push({ entity_id: r.entity_id, kind: 'financial_report', source_key: `financial_report:${r.entity_id}:${fr}`, due_on: addMonths(fr, 4),
        title: `Lodge the FY${fr.slice(0, 4)} financial report with ASIC`, detail: `A public company lodges its financial report, directors' report and auditor's report within four months of its year end (${fr}).` });
      out.push({ entity_id: r.entity_id, kind: 'agm', source_key: `agm:${r.entity_id}:${ag}`, due_on: addMonths(ag, 5),
        title: `Hold the FY${ag.slice(0, 4)} AGM`, detail: `A public company holds its AGM within five months of its year end (${ag}); notice goes out at least 21 days before.` });
    }
  }

  for (const o of officers ?? []) {
    if (!australian.has(o.entity_id)) continue;
    const role = POSITIONS[o.position as Position]?.toLowerCase() ?? o.position;
    for (const [what, on] of [['appointed', o.appointed_on], ['ceased', o.ceased_on]] as const) {
      if (!on || on < since) continue;
      out.push({ entity_id: o.entity_id, kind: 'officer_change', source_key: `officer:${o.id}:${what}`, due_on: addDays(on, 28),
        title: `Tell ASIC: ${o.full_name} ${what === 'appointed' ? 'appointed' : 'stopped being'} ${role}`,
        detail: `ASIC must be told within 28 days of the change (${on}), on Form 484.${what === 'appointed' && o.position !== 'secretary' ? ' A new director needs a director ID before being appointed.' : ''}` });
    }
  }

  const byDay = new Map<string, { entity_id: string; on: string; shares: number; holders: Set<string> }>();
  for (const m of issues ?? []) {
    if (!australian.has(m.entity_id)) continue;
    const k = `${m.entity_id}:${m.moved_on}`;
    const e = byDay.get(k) ?? { entity_id: m.entity_id, on: m.moved_on, shares: 0, holders: new Set<string>() };
    e.shares += Number(m.shares); e.holders.add(m.holder_id);
    byDay.set(k, e);
  }
  for (const [k, e] of byDay) out.push({ entity_id: e.entity_id, kind: 'share_issue', source_key: `share_issue:${k}`, due_on: addDays(e.on, 28),
    title: `Tell ASIC about the shares issued on ${e.on}`,
    detail: `${new Intl.NumberFormat('en-AU').format(e.shares)} shares to ${e.holders.size} holder${e.holders.size === 1 ? '' : 's'} (${name.get(e.entity_id) ?? ''}'s register). ASIC must be told within 28 days, on Form 484.` });
  return out;
}

/**
 * Brings the calendar in step with the rules: new items are added once; an open
 * item whose date or wording changed is updated; done items are left alone.
 */
export async function syncObligations(svc: Svc, entityIds: string[], today = todayIn()) {
  const rules = await ruleItems(svc, entityIds, today);
  if (!rules.length) return 0;
  const { data: existing } = await svc.from('legal_obligations').select('id, source_key, status, due_on, title, detail, date_kept').in('source_key', rules.map((r) => r.source_key));
  const have = new Map((existing ?? []).map((e) => [e.source_key, e]));
  const add = rules.filter((r) => !have.has(r.source_key));
  if (add.length) await svc.from('legal_obligations').upsert(add, { onConflict: 'source_key', ignoreDuplicates: true });
  for (const r of rules) {
    const e = have.get(r.source_key);
    if (e && e.status === 'open' && ((!e.date_kept && e.due_on !== r.due_on) || e.title !== r.title || e.detail !== r.detail)) {
      await svc.from('legal_obligations').update({ ...(e.date_kept ? {} : { due_on: r.due_on }), title: r.title, detail: r.detail }).eq('id', e.id);
    }
  }
  return add.length;
}

/** Open items the rules made for an officer who is removed from the register. */
export const dropOfficerItems = (svc: Svc, officerId: string) =>
  svc.from('legal_obligations').delete().eq('status', 'open').like('source_key', `officer:${officerId}:%`);

// ---------------------------------------------------------------------------
// Reminders: each morning from 8am Sydney, one message per person
// ---------------------------------------------------------------------------
const ORDER = ['30', '7', '1'];
const shown = (d: string) => new Intl.DateTimeFormat('en-AU', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${d}T00:00:00Z`));
/** The reminder this item is due for today, or null. */
export function stageFor(o: Pick<Obligation, 'due_on' | 'reminded'>, today: string) {
  const left = daysBetween(today, o.due_on);
  if (left < 0) { const s = `over:${Math.floor(-left / 7)}`; return o.reminded.includes(s) ? null : s; }
  const s = left <= 1 ? '1' : left <= 7 ? '7' : left <= 30 ? '30' : null;
  if (!s) return null;
  // Not '30' after '7' was sent (an item added late gets the most urgent one only).
  return o.reminded.some((r) => r.startsWith('over:') || ORDER.indexOf(r) >= ORDER.indexOf(s)) ? null : s;
}

/** People with Legal "do" for this company (group roles count for every company). */
export async function legalPeople(svc: Svc, entityId: string) {
  const now = new Date().toISOString();
  const { data: perms } = await svc.from('role_permissions').select('role_key').eq('permission', 'legal.do');
  const keys = (perms ?? []).map((p) => p.role_key);
  if (!keys.length) return [];
  const { data } = await svc.from('user_roles').select('user_id, expires_at').in('role_key', keys).or(`entity_id.is.null,entity_id.eq.${entityId}`);
  return [...new Set((data ?? []).filter((r) => !r.expires_at || r.expires_at > now).map((r) => r.user_id as string))];
}

/** Everyone with Legal "do" anywhere, by name: who an item can be given to. */
export async function legalTeam(svc: Svc) {
  const now = new Date().toISOString();
  const { data: perms } = await svc.from('role_permissions').select('role_key').eq('permission', 'legal.do');
  const keys = (perms ?? []).map((p) => p.role_key);
  if (!keys.length) return [];
  const { data } = await svc.from('user_roles').select('user_id, expires_at, profiles(first_name, last_name, email)').in('role_key', keys);
  const seen = new Map<string, string>();
  for (const r of (data ?? []) as unknown as { user_id: string; expires_at: string | null; profiles: { first_name: string | null; last_name: string | null; email: string } | null }[]) {
    if (r.expires_at && r.expires_at <= now) continue;
    seen.set(r.user_id, [r.profiles?.first_name, r.profiles?.last_name].filter(Boolean).join(' ') || r.profiles?.email || 'Someone');
  }
  return [...seen].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
}

export async function legalReminders(svc: Svc, origin: string, now = new Date(), { force = false } = {}) {
  const hour = Number(new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Sydney', hour: '2-digit', hourCycle: 'h23' }).format(now));
  const today = todayIn(now);
  if (!force && hour < 8) return 0;
  const key = force ? `legal_reminders:manual:${now.toISOString()}` : `legal_reminders:${today}`;
  const { data: claimed } = await svc.from('notification_jobs').upsert({ key }, { onConflict: 'key', ignoreDuplicates: true }).select('key');
  if (!claimed?.length) return 0;
  // The calendar first takes in what the records say today.
  const { data: all } = await svc.from('company_records').select('entity_id');
  await syncObligations(svc, (all ?? []).map((r) => r.entity_id), today);

  const { data: open } = await svc.from('legal_obligations').select(`${OBLIGATION_COLUMNS}, entities(display_name)`).eq('status', 'open').lte('due_on', addDays(today, 30)).order('due_on');
  const perPerson = new Map<string, { o: Obligation & { company: string }; stage: string }[]>();
  const peopleOf = new Map<string, string[]>();
  for (const row of (open ?? []) as unknown as (Obligation & { entities: { display_name: string } | null })[]) {
    const stage = stageFor(row, today);
    if (!stage) continue;
    if (!peopleOf.has(row.entity_id)) peopleOf.set(row.entity_id, await legalPeople(svc, row.entity_id));
    const to = row.owner_id ? [row.owner_id] : peopleOf.get(row.entity_id)!;
    for (const id of to) perPerson.set(id, [...(perPerson.get(id) ?? []), { o: { ...row, company: row.entities?.display_name ?? '' }, stage }]);
  }
  let sent = 0;
  for (const [userId, items] of perPerson) {
    const over = items.filter((i) => daysBetween(today, i.o.due_on) < 0).length;
    const soon = items.length - over;
    const line = (i: (typeof items)[number]) => { const left = daysBetween(today, i.o.due_on); return `• ${i.o.company}: ${i.o.title} (${left < 0 ? `${-left} day${left === -1 ? '' : 's'} overdue` : left === 0 ? 'due today' : `due ${shown(i.o.due_on)}`})`; };
    const title = `Legal: ${[over && `${over} overdue`, soon && `${soon} due soon`].filter(Boolean).join(', ')}`;
    sent += await notifyMembers({
      kind: 'admin_legal', userIds: [userId], origin, link: '/admin/legal', title,
      body: `What needs doing for the companies you look after:\n\n${items.slice(0, 30).map(line).join('\n')}${items.length > 30 ? `\n• …and ${items.length - 30} more` : ''}\n\nMark each one done in Admin → Legal, with the proof (an ASIC receipt or the signed resolution).`,
      pushDetail: title,
    });
  }
  for (const { o, stage } of [...perPerson.values()].flat()) {
    if (!o.reminded.includes(stage)) { o.reminded.push(stage); await svc.from('legal_obligations').update({ reminded: o.reminded }).eq('id', o.id); }
  }
  return sent;
}

// ---------------------------------------------------------------------------
// Officers' private details
// ---------------------------------------------------------------------------
export const privateReady = integrationsReady;
export const sealPrivate = (p: OfficerPrivate) => {
  const clean = Object.fromEntries(Object.entries(p).filter(([, v]) => typeof v === 'string' && v.trim()).map(([k, v]) => [k, (v as string).trim().slice(0, 300)]));
  return Object.keys(clean).length ? sealJson(clean) : null;
};
export const openPrivate = (sealed: string | null): OfficerPrivate => (sealed ? openJson<OfficerPrivate>(sealed) : {});
/** Director IDs are 15 digits (036 then 12 more). */
export const directorIdProblem = (v: string) => (v && !/^036\d{12}$/.test(v.replace(/\s/g, '')) ? 'A director ID is 15 digits starting with 036.' : '');

// ---------------------------------------------------------------------------
// Calendar feed (a private address per person)
// ---------------------------------------------------------------------------
export const hashToken = (t: string) => createHash('sha256').update(t).digest('hex');
export async function newFeedToken(svc: Svc, userId: string) {
  const token = randomBytes(24).toString('base64url');
  await svc.from('legal_calendar_feeds').upsert({ user_id: userId, token_hash: hashToken(token), created_at: new Date().toISOString() }).throwOnError();
  return token;
}

const ics = (s: string) => s.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/[,;]/g, (c) => `\\${c}`);
/** Folds lines at 75 octets, as calendars expect. */
const fold = (line: string) => { const out: string[] = []; let s = line; while (Buffer.byteLength(s) > 74) { let n = 74; while (Buffer.byteLength(s.slice(0, n)) > 74) n--; out.push(s.slice(0, n)); s = ` ${s.slice(n)}`; } out.push(s); return out.join('\r\n'); };
export function calendarFile(items: (Obligation & { company: string })[], origin: string) {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Lakeba//Legal calendar//EN', 'CALSCALE:GREGORIAN', 'X-WR-CALNAME:Lakeba legal deadlines', 'REFRESH-INTERVAL;VALUE=DURATION:PT6H'];
  for (const o of items) {
    const day = o.due_on.replace(/-/g, '');
    lines.push('BEGIN:VEVENT', `UID:${o.id}@lakeba-legal`, `DTSTAMP:${stamp}`, `DTSTART;VALUE=DATE:${day}`, `DTEND;VALUE=DATE:${addDays(o.due_on, 1).replace(/-/g, '')}`,
      fold(`SUMMARY:${ics(`${o.company}: ${o.title}`)}`), fold(`DESCRIPTION:${ics(`${o.detail}\n\n${origin}/admin/legal/calendar`)}`), 'TRANSP:TRANSPARENT', 'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
}
