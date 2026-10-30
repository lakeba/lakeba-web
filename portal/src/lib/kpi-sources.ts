import type { serviceClient } from './admin';
import { policiesFor } from './hr';

// Where KPI results come from (docs/kpi-plan.md, "Automatic sources"). Each automatic source has a label and
// either a daily loader (the morning refresh in kpis.ts asks it for each person's value today) or none, when
// the source writes its results itself (commission runs, on approval). A connector (HubSpot, GitHub, Jira…)
// is one more entry here with its loader.

type Svc = ReturnType<typeof serviceClient>;
export type SourcePerson = { id: string; entity_id: string };
/** Each person's value today (missing, or null: nothing to measure, so no result). */
export type Loader = (svc: Svc, people: SourcePerson[]) => Promise<Map<string, number | null>>;
export type Source = { label: string; short: string; hint: string; daily: Loader | null };

const NONE = '00000000-0000-0000-0000-000000000000';
const pct = (done: number, total: number) => (total ? Math.round((done / total) * 10_000) / 100 : null);

/** % of the policies that need accepting (published, current version) the person has accepted. */
const policiesAccepted: Loader = async (svc, people) => {
  const out = new Map<string, number | null>();
  const { data: acks } = await svc.from('policy_acks').select('policy_id, version, person_id').in('person_id', people.length ? people.map((p) => p.id) : [NONE]);
  const policiesOf = new Map<string, Awaited<ReturnType<typeof policiesFor>>>();
  for (const p of people) {
    if (!policiesOf.has(p.entity_id)) policiesOf.set(p.entity_id, (await policiesFor(svc, p.entity_id)).filter((x) => x.requires_ack));
    const required = policiesOf.get(p.entity_id)!;
    const done = required.filter((x) => (acks ?? []).some((a) => a.person_id === p.id && a.policy_id === x.id && a.version === x.version)).length;
    out.set(p.id, pct(done, required.length));
  }
  return out;
};

/** % of the person's onboarding checklist that is done. */
const onboardingDone: Loader = async (svc, people) => {
  const out = new Map<string, number | null>();
  const { data: tasks } = await svc.from('person_tasks').select('person_id, done_at').eq('kind', 'onboarding').in('person_id', people.length ? people.map((p) => p.id) : [NONE]);
  for (const p of people) {
    const mine = (tasks ?? []).filter((t) => t.person_id === p.id);
    out.set(p.id, pct(mine.filter((t) => t.done_at).length, mine.length));
  }
  return out;
};

/** Every automatic source (besides "Entered by hand"). */
export const AUTO_SOURCES: Record<string, Source> = {
  sales_attributed: {
    label: 'Commission runs (sales credited)', short: 'commission runs', daily: null,
    hint: 'Commission runs: when Finance approves a run, the revenue credited to the person in it becomes a confirmed result (use A$, add them up).',
  },
  policies_accepted: {
    label: 'HR policies accepted (%)', short: 'HR policies', daily: policiesAccepted,
    hint: 'HR policies accepted: each morning, the share of the company’s policies that need accepting (current versions) the person has accepted (use %, latest).',
  },
  onboarding_done: {
    label: 'Onboarding checklist done (%)', short: 'the onboarding checklist', daily: onboardingDone,
    hint: 'Onboarding checklist: each morning, the share of the person’s onboarding tasks that are done (use %, latest).',
  },
};

/** The sources the morning refresh fills in. */
export const DAILY_SOURCES = Object.entries(AUTO_SOURCES).filter(([, s]) => s.daily).map(([k]) => k);
/** The source_ref of a daily source's result: one per item, replaced each morning. */
export const AUTO_REF = 'auto';
