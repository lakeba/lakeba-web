import { randomUUID } from 'node:crypto';
import type { Access } from './access';
import type { serviceClient } from './admin';
import { notifyMembers } from './notify';
import { shortDate } from './format';
import { hrCompanies, hrTeam, todayIn } from './hr';
import { AUTO_REF, AUTO_SOURCES, DAILY_SOURCES } from './kpi-sources';

// KPIs and reviews (Admin → People → Performance, My HR → My performance and My team; docs/kpi-plan.md).
// A scorecard is one person's KPIs for one period: each item has a target, a weight (they add up to 100)
// and two thresholds. Results come in by hand (HR, or proposed by Finance and confirmed by HR); only
// confirmed ones count. The score suggests a rating at review time; people decide the rating. Automatic sources
// (lib/kpi-sources.ts) write confirmed results themselves: commission runs on approval, the others each morning.

type Svc = ReturnType<typeof serviceClient>;

export const UNITS = { aud: 'A$', percent: '%', count: 'Count', days: 'Days', hours: 'Hours', score: 'Score' } as const;
export const DIRECTIONS = { higher: 'Higher is better', lower: 'Lower is better' } as const;
export const AGGREGATIONS = { sum: 'Add them up', average: 'Average', last: 'Latest' } as const;
export const FAMILIES = { revenue: 'Revenue', delivery: 'Delivery', engineering: 'Engineering', customer: 'Customer', compliance: 'Compliance', other: 'Other' } as const;
/** Where results come from: by hand, or an automatic source that writes confirmed results itself. */
export const SOURCES: Record<string, string> = { manual: 'Entered by hand', ...Object.fromEntries(Object.entries(AUTO_SOURCES).map(([k, s]) => [k, s.label])) };
/** Where an automatic result came from, in a sentence ("from HR policies"); null for results entered by hand. */
export const sourceShort = (source: string) => (source === 'manual' ? null : AUTO_SOURCES[source]?.short ?? source);
/** "Updated 31 Oct 2026 from HR policies" for an automatic result (null for one entered by hand). */
export const updatedFrom = (r: Pick<Result, 'source' | 'confirmed_at' | 'created_at'>) => {
  const from = sourceShort(r.source);
  return from ? `Updated ${shortDate.format(new Date(r.confirmed_at ?? r.created_at))} from ${from}` : null;
};
export const PERIOD_KINDS = { month: 'Month', quarter: 'Quarter', year: 'Year' } as const;
export const PERIOD_STATES = { planning: 'Planning', open: 'Open', closed: 'Closed' } as const;
export const CARD_STATES = { draft: 'Draft', active: 'Active', in_review: 'In review', signed_off: 'Signed off' } as const;
export const RATINGS = { 1: 'Below expectations', 2: 'Partly meets', 3: 'Meets', 4: 'Exceeds', 5: 'Outstanding' } as const;
export type Rating = keyof typeof RATINGS;
export const ratingLabel = (r: number | null | undefined) => (r && r in RATINGS ? `${r} · ${RATINGS[r as Rating]}` : '—');

export type Unit = keyof typeof UNITS;
export type Definition = {
  id: string; entity_id: string | null; name: string; description: string; unit: Unit; direction: keyof typeof DIRECTIONS;
  aggregation: keyof typeof AGGREGATIONS; family: keyof typeof FAMILIES; source: string; archived_at: string | null;
};
export type RoleSet = { id: string; entity_id: string | null; name: string; description: string; archived_at: string | null };
export type Period = { id: string; entity_id: string; label: string; kind: keyof typeof PERIOD_KINDS; starts_on: string; ends_on: string; status: keyof typeof PERIOD_STATES };
export type Goal = { id: string; entity_id: string; period_id: string; parent_id: string | null; title: string; description: string; team: string; target: number | null; unit: Unit | null; sort: number };
export type Scorecard = { id: string; entity_id: string; period_id: string; person_id: string; status: keyof typeof CARD_STATES; role_set_id: string | null; activated_at: string | null; created_at: string };
export type Item = { id: string; scorecard_id: string; definition_id: string; goal_id: string | null; target: number | null; weight: number; below: number | null; stretch: number | null; note: string; sort: number; off_track_alerted_at?: string | null };
export type Result = {
  id: string; item_id: string; value: number; as_of: string; source: string; source_ref: string | null; note: string; evidence_path: string | null;
  status: 'proposed' | 'confirmed'; proposed_by: string | null; proposed_at: string | null; confirmed_by: string | null; confirmed_at: string | null; created_at: string;
};
export type Checkin = { id: string; scorecard_id: string; author_id: string | null; author_role: 'hr' | 'manager' | 'employee'; body: string; private: boolean; created_at: string };
export type Review = {
  scorecard_id: string; self_text: string; self_rating: number | null; self_by: string | null; self_at: string | null;
  manager_text: string; manager_rating: number | null; manager_by: string | null; manager_at: string | null;
  agreed_rating: number | null; signed_off_by: string | null; signed_off_at: string | null; acknowledged_at: string | null; employee_comment: string;
};

export const DEFINITION_COLUMNS = 'id, entity_id, name, description, unit, direction, aggregation, family, source, archived_at';
export const ROLE_SET_COLUMNS = 'id, entity_id, name, description, archived_at';
export const PERIOD_COLUMNS = 'id, entity_id, label, kind, starts_on, ends_on, status';
export const GOAL_COLUMNS = 'id, entity_id, period_id, parent_id, title, description, team, target, unit, sort';
export const SCORECARD_COLUMNS = 'id, entity_id, period_id, person_id, status, role_set_id, activated_at, created_at';
export const ITEM_COLUMNS = 'id, scorecard_id, definition_id, goal_id, target, weight, below, stretch, note, sort, off_track_alerted_at';
export const RESULT_COLUMNS = 'id, item_id, value, as_of, source, source_ref, note, evidence_path, status, proposed_by, proposed_at, confirmed_by, confirmed_at, created_at';
export const CHECKIN_COLUMNS = 'id, scorecard_id, author_id, author_role, body, private, created_at';
export const REVIEW_COLUMNS = 'scorecard_id, self_text, self_rating, self_by, self_at, manager_text, manager_rating, manager_by, manager_at, agreed_rating, signed_off_by, signed_off_at, acknowledged_at, employee_comment';

const NONE = '00000000-0000-0000-0000-000000000000';
const ids = (list: string[]) => (list.length ? list : [NONE]);

// ---------------------------------------------------------------------------
// Numbers
// ---------------------------------------------------------------------------
/** A value in its KPI's unit ("A$12,500", "92%", "4.5 hours"). */
export function showValue(v: number | null | undefined, unit: Unit) {
  if (v == null || !Number.isFinite(Number(v))) return '—';
  const n = Number(v);
  const num = new Intl.NumberFormat('en-AU', { maximumFractionDigits: unit === 'aud' ? 0 : 2 }).format(n);
  if (unit === 'aud') return `A$${num}`;
  if (unit === 'percent') return `${num}%`;
  if (unit === 'days' || unit === 'hours') return `${num} ${n === 1 ? unit.slice(0, -1) : unit}`;
  return num;
}
export const showPercent = (v: number | null | undefined) => (v == null ? '—' : `${Math.round(v * 100)}%`);
/** A number typed in a form ("12,500", "A$3k" is not understood: digits, a point and a minus only). */
export const readNumber = (s: string) => {
  const clean = s.replace(/[^\d.-]/g, '');
  return clean && Number.isFinite(Number(clean)) ? Number(clean) : null;
};

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------
/** Attainment is capped at 150%: one great KPI can't hide the others. */
export const ATTAINMENT_CAP = 1.5;

/**
 * The suggested rating from a scorecard's score (its weighted attainment). It only suggests: the manager and
 * HR agree the rating at review.
 *   under 70%  → 1 Below expectations
 *   70–89%     → 2 Partly meets
 *   90–109%    → 3 Meets
 *   110–129%   → 4 Exceeds
 *   130% up    → 5 Outstanding (the cap is 150%)
 */
export const RATING_BANDS: { from: number; rating: Rating }[] = [
  { from: 1.3, rating: 5 }, { from: 1.1, rating: 4 }, { from: 0.9, rating: 3 }, { from: 0.7, rating: 2 }, { from: -Infinity, rating: 1 },
];
export const suggestedRating = (score: number | null): Rating | null => (score == null ? null : RATING_BANDS.find((b) => score >= b.from)!.rating);

/** The period's actual for an item: its confirmed results in the period, added up as its KPI says. */
export function actualOf(results: Pick<Result, 'value' | 'as_of' | 'status' | 'created_at'>[], aggregation: Definition['aggregation'], period?: Pick<Period, 'starts_on' | 'ends_on'>) {
  const list = results.filter((r) => r.status === 'confirmed' && (!period || (r.as_of >= period.starts_on && r.as_of <= period.ends_on)));
  if (!list.length) return null;
  const values = list.map((r) => Number(r.value));
  if (aggregation === 'sum') return values.reduce((s, v) => s + v, 0);
  if (aggregation === 'average') return values.reduce((s, v) => s + v, 0) / values.length;
  const latest = [...list].sort((a, b) => a.as_of.localeCompare(b.as_of) || a.created_at.localeCompare(b.created_at)).at(-1)!;
  return Number(latest.value);
}

/** Attainment: actual ÷ target (target ÷ actual when lower is better), between 0 and 150%. */
export function attainment(actual: number | null, target: number | null, direction: Definition['direction']) {
  if (actual == null || target == null) return null;
  let a: number;
  if (direction === 'higher') {
    if (target <= 0) return actual > 0 ? ATTAINMENT_CAP : actual === 0 ? 1 : 0;
    a = actual / target;
  } else {
    // Lower is better: at or under the target is 100% or more; nothing at all (0 incidents) is the cap.
    if (actual <= 0) return ATTAINMENT_CAP;
    a = target <= 0 ? 0 : target / actual;
  }
  return Math.max(0, Math.min(ATTAINMENT_CAP, a));
}

/** How far through the period a date is (0–1). */
export function elapsed(period: Pick<Period, 'starts_on' | 'ends_on'>, today = todayIn()) {
  const day = (d: string) => Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10)));
  if (today >= period.ends_on) return 1;
  if (today < period.starts_on) return 0;
  return (day(today) - day(period.starts_on) + 864e5) / (day(period.ends_on) - day(period.starts_on) + 864e5);
}

export const TRACK = { none: 'No results yet', off: 'Off track', on: 'On track', met: 'Met', stretch: 'Stretch' } as const;
export type Track = keyof typeof TRACK;

/**
 * Where an item stands. Thresholds are in the KPI's unit: under "below" is off track (over it, when lower is
 * better); at the target it's met; at "stretch" beyond. Without a "below", under 80% of the target is off track.
 * For higher-is-better KPIs that add up over the period (sum), the target and thresholds are pro-rated while the
 * period runs, so a quarter's revenue isn't off track in its first week. Lower-is-better sums (incidents) are a
 * budget for the whole period and aren't pro-rated.
 */
export function trackOf(item: Pick<Item, 'target' | 'below' | 'stretch'>, def: Pick<Definition, 'direction' | 'aggregation'>, actual: number | null, period?: Pick<Period, 'starts_on' | 'ends_on'>, today = todayIn()): Track {
  if (actual == null || item.target == null) return 'none';
  const pace = def.aggregation === 'sum' && def.direction === 'higher' && period ? Math.max(elapsed(period, today), 0.0001) : 1;
  const scaled = (v: number | null) => (v == null ? null : v * pace);
  const target = scaled(Number(item.target))!;
  const below = scaled(item.below == null ? (def.direction === 'higher' ? Number(item.target) * 0.8 : Number(item.target) * 1.25) : Number(item.below));
  const stretch = scaled(item.stretch == null ? null : Number(item.stretch));
  const better = (a: number, b: number) => (def.direction === 'higher' ? a >= b : a <= b);
  if (stretch != null && better(actual, stretch)) return 'stretch';
  if (better(actual, target)) return 'met';
  if (below != null && !better(actual, below)) return 'off';
  return 'on';
}

export type ScoredItem = Item & { definition: Definition; results: Result[]; actual: number | null; attainment: number | null; track: Track };

/** Scores a scorecard's items. */
export function scoreItems(items: (Item & { definition: Definition; results: Result[] })[], period?: Pick<Period, 'starts_on' | 'ends_on'>, today = todayIn()): ScoredItem[] {
  return items.map((i) => {
    const actual = actualOf(i.results, i.definition.aggregation, period);
    return { ...i, actual, attainment: attainment(actual, i.target == null ? null : Number(i.target), i.definition.direction), track: trackOf(i, i.definition, actual, period, today) };
  });
}

/**
 * The scorecard's score: the weighted average of its items' attainment, over the items that have results.
 * `coverage` is the share of the weight that has results (1 when every item has one).
 */
export function scoreOf(items: Pick<ScoredItem, 'weight' | 'attainment'>[]) {
  const total = items.reduce((s, i) => s + Number(i.weight), 0);
  const counted = items.filter((i) => i.attainment != null && Number(i.weight) > 0);
  const w = counted.reduce((s, i) => s + Number(i.weight), 0);
  if (!w) return { score: null as number | null, coverage: 0 };
  return { score: counted.reduce((s, i) => s + Number(i.weight) * i.attainment!, 0) / w, coverage: total ? w / total : 0 };
}

/** What stops a draft becoming active (empty: ready). */
export function readyProblems(items: Pick<Item, 'target' | 'weight'>[]) {
  const out: string[] = [];
  if (!items.length) out.push('Add at least one KPI.');
  const total = items.reduce((s, i) => s + Number(i.weight), 0);
  if (items.length && Math.abs(total - 100) > 0.001) out.push(`The weights add up to ${Math.round(total * 100) / 100}, not 100.`);
  if (items.some((i) => i.target == null)) out.push('Every KPI needs a target.');
  return out;
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------
export type FullScorecard = Scorecard & {
  period: Period; person: { id: string; entity_id: string; full_name: string; job_title: string; user_id: string | null; manager_id: string | null; status: string };
  items: ScoredItem[]; checkins: Checkin[]; review: Review | null; score: number | null; coverage: number; suggested: Rating | null;
};

/** A scorecard with its period, person, scored items and results, check-ins (private ones only with `privateToo`) and review. */
export async function loadScorecard(svc: Svc, id: string, { privateToo = false } = {}): Promise<FullScorecard | null> {
  const { data: card } = await svc.from('kpi_scorecards').select(SCORECARD_COLUMNS).eq('id', id).maybeSingle();
  if (!card) return null;
  const [{ data: period }, { data: person }, { data: itemRows }, { data: checkins }, { data: review }] = await Promise.all([
    svc.from('kpi_periods').select(PERIOD_COLUMNS).eq('id', card.period_id).single(),
    svc.from('people').select('id, entity_id, full_name, job_title, user_id, manager_id, status').eq('id', card.person_id).single(),
    svc.from('kpi_scorecard_items').select(ITEM_COLUMNS).eq('scorecard_id', id).order('sort'),
    (() => { let q = svc.from('kpi_checkins').select(CHECKIN_COLUMNS).eq('scorecard_id', id).order('created_at'); if (!privateToo) q = q.eq('private', false); return q; })(),
    svc.from('kpi_reviews').select(REVIEW_COLUMNS).eq('scorecard_id', id).maybeSingle(),
  ]);
  const items = (itemRows ?? []) as Item[];
  const [{ data: defs }, { data: results }] = await Promise.all([
    svc.from('kpi_definitions').select(DEFINITION_COLUMNS).in('id', ids(items.map((i) => i.definition_id))),
    svc.from('kpi_results').select(RESULT_COLUMNS).in('item_id', ids(items.map((i) => i.id))).order('as_of').order('created_at'),
  ]);
  const defOf = new Map(((defs ?? []) as Definition[]).map((d) => [d.id, d]));
  const scored = scoreItems(items.map((i) => ({ ...i, definition: defOf.get(i.definition_id)!, results: ((results ?? []) as Result[]).filter((r) => r.item_id === i.id) })), period as Period);
  const { score, coverage } = scoreOf(scored);
  return {
    ...(card as Scorecard), period: period as Period, person: person as FullScorecard['person'], items: scored,
    checkins: (checkins ?? []) as Checkin[], review: (review ?? null) as Review | null, score, coverage, suggested: suggestedRating(score),
  };
}

/** Many scorecards' scored items at once: card id → its items with their results, actual, attainment and state. */
export async function scoredItemsFor(svc: Svc, cards: Pick<Scorecard, 'id' | 'period_id'>[], periods: Pick<Period, 'id' | 'starts_on' | 'ends_on'>[], today = todayIn()) {
  const out = new Map<string, ScoredItem[]>();
  if (!cards.length) return out;
  const { data: itemRows } = await svc.from('kpi_scorecard_items').select(ITEM_COLUMNS).in('scorecard_id', cards.map((c) => c.id)).order('sort');
  const items = (itemRows ?? []) as Item[];
  const [{ data: defs }, { data: results }] = await Promise.all([
    svc.from('kpi_definitions').select(DEFINITION_COLUMNS).in('id', ids([...new Set(items.map((i) => i.definition_id))])),
    svc.from('kpi_results').select(RESULT_COLUMNS).in('item_id', ids(items.map((i) => i.id))).order('as_of').order('created_at'),
  ]);
  const defOf = new Map(((defs ?? []) as Definition[]).map((d) => [d.id, d]));
  const periodOf = new Map(periods.map((p) => [p.id, p]));
  const res = (results ?? []) as Result[];
  for (const c of cards) {
    const mine = items.filter((i) => i.scorecard_id === c.id);
    out.set(c.id, scoreItems(mine.map((i) => ({ ...i, definition: defOf.get(i.definition_id)!, results: res.filter((r) => r.item_id === i.id) })), periodOf.get(c.period_id), today));
  }
  return out;
}

/** Many scorecards' scores at once (for lists): id → score, suggested rating, item count and off-track count. */
export async function scoresFor(svc: Svc, cards: Pick<Scorecard, 'id' | 'period_id'>[], periods: Pick<Period, 'id' | 'starts_on' | 'ends_on'>[]) {
  const out = new Map<string, { score: number | null; coverage: number; suggested: Rating | null; items: number; off: number; proposed: number }>();
  const scored = await scoredItemsFor(svc, cards, periods);
  for (const c of cards) {
    const list = scored.get(c.id) ?? [];
    const { score, coverage } = scoreOf(list);
    out.set(c.id, { score, coverage, suggested: suggestedRating(score), items: list.length, off: list.filter((i) => i.track === 'off').length, proposed: list.flatMap((i) => i.results).filter((r) => r.status === 'proposed').length });
  }
  return out;
}

/** Definitions and role sets a company may use: its own and the group's (archived ones left out unless asked). */
export async function libraryFor(svc: Svc, entityIds: string[], { archived = false } = {}) {
  const or = `entity_id.is.null,entity_id.in.(${ids(entityIds).join(',')})`;
  let d = svc.from('kpi_definitions').select(DEFINITION_COLUMNS).or(or).order('family').order('name');
  let r = svc.from('kpi_role_sets').select(ROLE_SET_COLUMNS).or(or).order('name');
  if (!archived) { d = d.is('archived_at', null); r = r.is('archived_at', null); }
  const [{ data: defs }, { data: sets }] = await Promise.all([d, r]);
  const setIds = (sets ?? []).map((s) => s.id as string);
  const { data: setItems } = await svc.from('kpi_role_set_items').select('role_set_id, definition_id, weight, sort').in('role_set_id', ids(setIds)).order('sort');
  return {
    definitions: (defs ?? []) as Definition[],
    roleSets: ((sets ?? []) as RoleSet[]).map((s) => ({ ...s, items: ((setItems ?? []) as { role_set_id: string; definition_id: string; weight: number; sort: number }[]).filter((i) => i.role_set_id === s.id) })),
  };
}

/**
 * Everyone below these people in the org chart (their reports, their reports' reports…), current only,
 * across companies. A loop of managers is stopped where found.
 */
export async function reportsOf(svc: Svc, managerIds: string[]) {
  if (!managerIds.length) return [];
  const { data } = await svc.from('people').select('id, entity_id, full_name, job_title, manager_id, user_id, status').neq('status', 'left');
  const people = (data ?? []) as { id: string; entity_id: string; full_name: string; job_title: string; manager_id: string | null; user_id: string | null; status: string }[];
  const under = new Map<string, typeof people>();
  for (const p of people) if (p.manager_id) under.set(p.manager_id, [...(under.get(p.manager_id) ?? []), p]);
  const seen = new Set<string>(managerIds);
  const out: typeof people = [];
  const queue = [...managerIds];
  while (queue.length) {
    for (const r of under.get(queue.shift()!) ?? []) {
      if (seen.has(r.id)) continue;
      seen.add(r.id); out.push(r); queue.push(r.id);
    }
  }
  return out.sort((a, b) => a.full_name.localeCompare(b.full_name));
}

/** Whether this person is somewhere above the scorecard's person (the manager side of My HR → My team). */
export async function managesPerson(svc: Svc, myPersonIds: string[], personId: string) {
  return (await reportsOf(svc, myPersonIds)).some((r) => r.id === personId);
}

/** Names of the people who wrote check-ins or results (profiles). */
export async function namesOf(svc: Svc, userIds: (string | null)[]) {
  const list = [...new Set(userIds.filter((u): u is string => Boolean(u)))];
  if (!list.length) return new Map<string, string>();
  const { data } = await svc.from('profiles').select('id, first_name, last_name, email').in('id', list);
  return new Map((data ?? []).map((p) => [p.id as string, [p.first_name, p.last_name].filter(Boolean).join(' ') || (p.email as string) || 'Someone']));
}

// ---------------------------------------------------------------------------
// Who works on scorecards
// ---------------------------------------------------------------------------
type Company = { id: string; code: string; display_name: string; legal_name: string | null };

/**
 * The companies whose scorecards this person may open: HR's (hr.view), and for Finance (accounting.do,
 * Lakeba's team) every company, to propose results. `finance` lists the companies they see only as Finance.
 */
export async function performanceCompanies(svc: Svc, access: Access) {
  const hr = await hrCompanies(svc, access);
  const fin = access.companies('accounting.do');
  if (fin !== 'all' && !fin.length) return { companies: hr, finance: new Set<string>() };
  let q = svc.from('entities').select('id, code, display_name, legal_name').eq('portal', 'full').order('sort');
  if (fin !== 'all') q = q.in('id', ids(fin));
  const more = ((await q).data ?? []) as Company[];
  const extra = more.filter((c) => !hr.some((h) => h.id === c.id));
  return { companies: [...hr, ...extra], finance: new Set(extra.map((c) => c.id)) };
}

// ---------------------------------------------------------------------------
// Moving a scorecard on (each tells the person, when they have a portal account)
// ---------------------------------------------------------------------------
async function tellPerson(svc: Svc, card: Pick<Scorecard, 'entity_id' | 'person_id'>, origin: string, title: string, body: string) {
  const { data: p } = await svc.from('people').select('user_id, status').eq('id', card.person_id).single();
  if (!p?.user_id || p.status === 'left') return 0;
  return notifyMembers({ kind: 'my_hr', userIds: [p.user_id], origin, link: '/my-hr/performance', entityId: card.entity_id, title, body }).catch(() => 0);
}

export async function activateScorecard(svc: Svc, card: Scorecard & { period: Period }, origin: string) {
  const now = new Date().toISOString();
  await svc.from('kpi_scorecards').update({ status: 'active', activated_at: card.activated_at ?? now, updated_at: now }).eq('id', card.id).throwOnError();
  await tellPerson(svc, card, origin, `Your KPIs for ${card.period.label}`, `Your scorecard for ${card.period.label} is ready: the KPIs, their targets and how much each counts. You can follow your results and add comments in My HR.`);
}

/** Active scorecards go to review (HR starts it, or the period closes); the person is asked for their self-assessment. */
export async function startReview(svc: Svc, cards: (Pick<Scorecard, 'id' | 'entity_id' | 'person_id'>)[], periodLabel: string, origin: string) {
  if (!cards.length) return;
  const now = new Date().toISOString();
  await svc.from('kpi_scorecards').update({ status: 'in_review', updated_at: now }).in('id', cards.map((c) => c.id)).eq('status', 'active').throwOnError();
  await svc.from('kpi_reviews').upsert(cards.map((c) => ({ scorecard_id: c.id })), { onConflict: 'scorecard_id', ignoreDuplicates: true }).throwOnError();
  for (const c of cards) await tellPerson(svc, c, origin, `Your review for ${periodLabel}`, `${periodLabel} is ending, so it’s time for your review. Add your own assessment and rating in My HR; your manager adds theirs, then HR signs it off.`);
}

export async function signOffReview(svc: Svc, card: Scorecard & { period: Period }, rating: Rating, userId: string, origin: string) {
  const now = new Date().toISOString();
  await svc.from('kpi_reviews').update({ agreed_rating: rating, signed_off_by: userId, signed_off_at: now, updated_at: now }).eq('scorecard_id', card.id).throwOnError();
  await svc.from('kpi_scorecards').update({ status: 'signed_off', updated_at: now }).eq('id', card.id).throwOnError();
  await tellPerson(svc, card, origin, `Your review for ${card.period.label} is signed off`, `Your review for ${card.period.label} is signed off with a rating of ${ratingLabel(rating)}. Read it in My HR, acknowledge it, and add a comment if you’d like.`);
}

/** Where a result's evidence file is kept (the "legal" bucket, under the company's HR folder). */
export const evidencePath = (entityId: string, cardId: string, name: string) => `${entityId}/hr/kpis/${cardId}/${randomUUID()}-${name.replace(/[^\p{L}\p{N} ._()-]/gu, '').slice(-120)}`;

// ---------------------------------------------------------------------------
// Automation: the morning refresh of automatic results, and off-track alerts
// ---------------------------------------------------------------------------
/**
 * Fills in the daily automatic sources (lib/kpi-sources.ts) on every active or in-review scorecard in an open
 * period (of one company, or all): one confirmed result per item, dated today (inside the period), replacing the
 * item's previous automatic result, so a KPI that adds up doesn't count the same state twice. People with nothing
 * to measure (no required policies, no checklist) get no result. Returns how many results were written.
 */
export async function refreshAutoResults(svc: Svc, { entityId, now = new Date() }: { entityId?: string; now?: Date } = {}) {
  const today = todayIn(now);
  let q = svc.from('kpi_scorecards').select('id, entity_id, person_id, kpi_periods!inner(starts_on, ends_on, status)').in('status', ['active', 'in_review']).eq('kpi_periods.status', 'open');
  if (entityId) q = q.eq('entity_id', entityId);
  const cards = ((await q).data ?? []) as unknown as { id: string; entity_id: string; person_id: string; kpi_periods: Pick<Period, 'starts_on' | 'ends_on'> }[];
  if (!cards.length) return { written: 0, cleared: 0 };
  const { data: itemRows } = await svc.from('kpi_scorecard_items').select('id, scorecard_id, kpi_definitions!inner(source)').in('scorecard_id', cards.map((c) => c.id)).in('kpi_definitions.source', DAILY_SOURCES);
  const items = (itemRows ?? []) as unknown as { id: string; scorecard_id: string; kpi_definitions: { source: string } }[];
  if (!items.length) return { written: 0, cleared: 0 };
  const cardOf = new Map(cards.map((c) => [c.id, c]));
  const people = [...new Map(cards.map((c) => [c.person_id, { id: c.person_id, entity_id: c.entity_id }])).values()];
  const values = new Map<string, Map<string, number | null>>();
  for (const key of new Set(items.map((i) => i.kpi_definitions.source))) values.set(key, await AUTO_SOURCES[key].daily!(svc, people));
  const { data: oldRows } = await svc.from('kpi_results').select('id, item_id, source').in('item_id', items.map((i) => i.id)).eq('source_ref', AUTO_REF);
  const stamp = now.toISOString();
  let written = 0, cleared = 0;
  for (const item of items) {
    const card = cardOf.get(item.scorecard_id)!;
    const source = item.kpi_definitions.source;
    const value = values.get(source)?.get(card.person_id) ?? null;
    const old = (oldRows ?? []).find((r) => r.item_id === item.id && r.source === source);
    if (value == null) {
      if (old) { await svc.from('kpi_results').delete().eq('id', old.id).throwOnError(); cleared++; }
      continue;
    }
    const p = card.kpi_periods;
    const asOf = today > p.ends_on ? p.ends_on : today < p.starts_on ? p.starts_on : today;
    const row = { value, as_of: asOf, note: '', status: 'confirmed', confirmed_by: null, confirmed_at: stamp, updated_at: stamp };
    if (old) await svc.from('kpi_results').update(row).eq('id', old.id).throwOnError();
    else {
      const { error } = await svc.from('kpi_results').insert({ ...row, item_id: item.id, source, source_ref: AUTO_REF, proposed_at: stamp });
      // Written meanwhile by another refresh (the unique index keeps one per item): update that one.
      if (error?.code === '23505') await svc.from('kpi_results').update(row).eq('item_id', item.id).eq('source', source).eq('source_ref', AUTO_REF).throwOnError();
      else if (error) throw new Error(error.message);
    }
    written++;
  }
  return { written, cleared };
}

/** How long an off-track KPI waits before it's alerted again. */
export const ALERT_EVERY_DAYS = 14;

/**
 * Tells HR (kind 'hr') and the person's manager, when they're in the portal (kind 'my_hr'), about KPIs that are
 * off track on active scorecards in open periods: one message per scorecard, with its KPIs that weren't alerted
 * in the last 14 days. Returns how many scorecards were alerted.
 */
export async function offTrackAlerts(svc: Svc, origin: string, now = new Date()) {
  const today = todayIn(now);
  const { data: rows } = await svc.from('kpi_scorecards').select(`${SCORECARD_COLUMNS}, kpi_periods!inner(${PERIOD_COLUMNS}), people!inner(full_name, manager_id, status)`).eq('status', 'active').eq('kpi_periods.status', 'open').neq('people.status', 'left');
  const cards = (rows ?? []) as unknown as (Scorecard & { kpi_periods: Period; people: { full_name: string; manager_id: string | null; status: string } })[];
  if (!cards.length) return 0;
  const scored = await scoredItemsFor(svc, cards, cards.map((c) => c.kpi_periods), today);
  const since = now.getTime() - ALERT_EVERY_DAYS * 864e5;
  const managerIds = [...new Set(cards.map((c) => c.people.manager_id).filter((m): m is string => Boolean(m)))];
  const { data: managers } = await svc.from('people').select('id, user_id, status').in('id', ids(managerIds));
  const hrOf = new Map<string, string[]>();
  let alerted = 0;
  for (const c of cards) {
    const off = (scored.get(c.id) ?? []).filter((i) => i.track === 'off' && (!i.off_track_alerted_at || Date.parse(i.off_track_alerted_at) < since));
    if (!off.length) continue;
    if (!hrOf.has(c.entity_id)) hrOf.set(c.entity_id, await hrTeam(svc, c.entity_id));
    const hr = hrOf.get(c.entity_id)!;
    const m = (managers ?? []).find((x) => x.id === c.people.manager_id && x.user_id && x.status !== 'left');
    const manager = m && !hr.includes(m.user_id as string) ? (m.user_id as string) : null;
    const name = c.people.full_name;
    const list = off.map((i) => `${i.definition.name}: ${showValue(i.actual, i.definition.unit)} against a target of ${showValue(i.target, i.definition.unit)}`).join('; ');
    const title = `${name}: ${off.length} KPI${off.length === 1 ? '' : 's'} off track`;
    const body = `In ${c.kpi_periods.label}, ${off.length === 1 ? 'this KPI is' : 'these KPIs are'} off track for ${name}: ${list}. A check-in may help.`;
    // Nobody to tell (no HR people, no manager with an account): leave it unstamped, so it's told once someone is.
    if (!hr.length && !manager) continue;
    if (hr.length) await notifyMembers({ kind: 'hr', userIds: hr, origin, link: `/admin/hr/performance/${c.id}`, entityId: c.entity_id, title, body, pushDetail: name }).catch(() => 0);
    if (manager) await notifyMembers({ kind: 'my_hr', userIds: [manager], origin, link: `/my-hr/team?card=${c.id}`, entityId: c.entity_id, title, body, pushDetail: name }).catch(() => 0);
    await svc.from('kpi_scorecard_items').update({ off_track_alerted_at: now.toISOString() }).in('id', off.map((i) => i.id)).throwOnError();
    alerted++;
  }
  return alerted;
}

/** Each morning from 7am Sydney: refresh the automatic results, then alert what's off track. */
export async function kpiJobs(svc: Svc, origin: string, now = new Date()) {
  const hour = Number(new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Sydney', hour: '2-digit', hourCycle: 'h23' }).format(now));
  if (hour < 7) return 0;
  const { data: claimed } = await svc.from('notification_jobs').upsert({ key: `kpi_refresh:${todayIn(now)}` }, { onConflict: 'key', ignoreDuplicates: true }).select('key');
  if (!claimed?.length) return 0;
  const { written, cleared } = await refreshAutoResults(svc, { now });
  const alerted = await offTrackAlerts(svc, origin, now);
  if (written || cleared || alerted) await svc.from('audit_log').insert({ action: 'kpi_daily_refresh', detail: { results: written, cleared, scorecards_alerted: alerted } });
  return alerted;
}

// ---------------------------------------------------------------------------
// Board summary (Finance): a short people line per company, no names
// ---------------------------------------------------------------------------
export type BoardPeople = {
  entity_id: string; company: string; period: Pick<Period, 'label' | 'status'> | null; people: number; score: number | null;
  ratings: Record<Rating, number>; commission: { approved: number; paid: number; runs: number } | null;
};

/**
 * For each company: its latest open or closed performance period that has started by the board month's end —
 * how many people have a scorecard, the average score, the agreed ratings (counts) — and the commission in
 * approved or paid runs for periods ending in that month's quarter.
 */
export async function boardPeople(svc: Svc, monthEnd: string): Promise<BoardPeople[]> {
  const m = Number(monthEnd.slice(5, 7)), y = Number(monthEnd.slice(0, 4));
  const qStart = `${y}-${String(m - ((m - 1) % 3)).padStart(2, '0')}-01`;
  const qEnd = new Date(Date.UTC(y, m - ((m - 1) % 3) + 2, 0)).toISOString().slice(0, 10);
  const [{ data: periodRows }, { data: runs }] = await Promise.all([
    svc.from('kpi_periods').select(PERIOD_COLUMNS).in('status', ['open', 'closed']).lte('starts_on', monthEnd).order('starts_on', { ascending: false }),
    svc.from('commission_runs').select('id, entity_id, status').in('status', ['approved', 'paid']).gte('period_end', qStart).lte('period_end', qEnd),
  ]);
  const latest = new Map<string, Period>();
  for (const p of (periodRows ?? []) as Period[]) if (!latest.has(p.entity_id)) latest.set(p.entity_id, p);
  const periods = [...latest.values()];
  const { data: cardRows } = await svc.from('kpi_scorecards').select('id, entity_id, period_id, kpi_reviews(agreed_rating)').in('period_id', ids(periods.map((p) => p.id))).neq('status', 'draft');
  const cards = (cardRows ?? []) as unknown as { id: string; entity_id: string; period_id: string; kpi_reviews: { agreed_rating: number | null } | null }[];
  const scores = await scoresFor(svc, cards, periods);
  const { data: lines } = await svc.from('commission_run_lines').select('run_id, commission').in('run_id', ids((runs ?? []).map((r) => r.id as string)));
  const entityIds = [...new Set([...cards.map((c) => c.entity_id), ...(runs ?? []).map((r) => r.entity_id as string)])];
  const { data: entities } = await svc.from('entities').select('id, display_name, sort').in('id', ids(entityIds)).order('sort');
  return (entities ?? []).map((e) => {
    const mine = cards.filter((c) => c.entity_id === e.id);
    const list = mine.map((c) => scores.get(c.id)?.score).filter((s): s is number => s != null);
    const ratings = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } as Record<Rating, number>;
    for (const c of mine) { const r = c.kpi_reviews?.agreed_rating; if (r && r in ratings) ratings[r as Rating]++; }
    const myRuns = (runs ?? []).filter((r) => r.entity_id === e.id);
    const sum = (status?: string) => (lines ?? []).filter((l) => myRuns.some((r) => r.id === l.run_id && (!status || r.status === status))).reduce((s, l) => s + Number(l.commission), 0);
    const p = latest.get(e.id as string);
    return {
      entity_id: e.id as string, company: e.display_name as string, period: mine.length && p ? { label: p.label, status: p.status } : null, people: mine.length,
      score: list.length ? list.reduce((s, v) => s + v, 0) / list.length : null, ratings,
      commission: myRuns.length ? { approved: sum(), paid: sum('paid'), runs: myRuns.length } : null,
    };
  });
}
