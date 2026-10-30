import type { SupabaseClient } from '@supabase/supabase-js';

/*
 * Audit log filters: conditions, all of which must match (Admin → Audit log, its CSV export and deletion).
 * Each is a field, a rule and a value, in the address as ?f=user&o=not&v=someone@lakeba.com (repeated per
 * condition). Older addresses (?action=, ?email=, ?from=, ?to=, ?company=) still work.
 */

export type Field = 'user' | 'action' | 'company' | 'date';
export type Op = 'is' | 'not' | 'has' | 'lacks' | 'none' | 'on' | 'after' | 'before';
export type Rule = { field: Field; op: Op; value: string };
export type AuditFilters = { rules: Rule[] };

/** What each field offers, in the order shown. `none` needs no value. */
export const FIELDS: { key: Field; label: string; ops: [Op, string][] }[] = [
  { key: 'user', label: 'Person', ops: [['is', 'is'], ['not', 'is not'], ['has', 'contains'], ['lacks', 'doesn’t contain'], ['none', 'is the system']] },
  { key: 'action', label: 'Action', ops: [['is', 'is'], ['not', 'is not'], ['has', 'contains'], ['lacks', 'doesn’t contain']] },
  { key: 'company', label: 'Company', ops: [['is', 'is'], ['not', 'is not'], ['none', 'is none']] },
  { key: 'date', label: 'Date', ops: [['on', 'is'], ['after', 'is on or after'], ['before', 'is on or before']] },
];
const fieldOf = (f: string) => FIELDS.find((x) => x.key === f);

export function readFilters(params: URLSearchParams): AuditFilters {
  const fs = params.getAll('f');
  const os = params.getAll('o');
  const vs = params.getAll('v');
  const rules: Rule[] = [];
  fs.forEach((f, i) => {
    const field = fieldOf(f);
    const op = os[i] as Op;
    const value = (vs[i] ?? '').trim();
    if (!field || !field.ops.some(([o]) => o === op)) return;
    if (op !== 'none' && !value) return;
    if (field.key === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(value)) return;
    rules.push({ field: field.key, op, value: field.key === 'company' ? value.toUpperCase() : field.key === 'user' ? value.toLowerCase() : value });
  });
  // Older addresses.
  const legacy = (k: string) => params.get(k)?.trim() ?? '';
  if (legacy('action')) rules.push({ field: 'action', op: 'has', value: legacy('action') });
  if (legacy('email')) rules.push({ field: 'user', op: 'has', value: legacy('email').toLowerCase() });
  if (/^\d{4}-\d{2}-\d{2}$/.test(legacy('from'))) rules.push({ field: 'date', op: 'after', value: legacy('from') });
  if (/^\d{4}-\d{2}-\d{2}$/.test(legacy('to'))) rules.push({ field: 'date', op: 'before', value: legacy('to') });
  if (legacy('company')) rules.push({ field: 'company', op: 'is', value: legacy('company').toUpperCase() });
  return { rules };
}

/** The filters as address parameters (for links, the CSV export and the delete form). */
export const filterParams = (f: AuditFilters) => {
  const params = new URLSearchParams();
  for (const r of f.rules) { params.append('f', r.field); params.append('o', r.op); params.append('v', r.value); }
  return params;
};

/** The conditions in words, e.g. "Person is not g.porcelli@lakeba.com and Date is on or after 2026-10-01". */
export const describeFilters = (f: AuditFilters) =>
  f.rules.map((r) => {
    const field = fieldOf(r.field)!;
    const op = field.ops.find(([o]) => o === r.op)![1];
    return `${field.label} ${op}${r.op === 'none' ? '' : ` ${r.value}`}`;
  }).join(' and ');

/** Records of deletions themselves: never deleted, so trimming the log always leaves a trace. */
export const PROTECTED_ACTION = 'audit_log_deleted';

const like = (s: string) => `%${s.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
// Values inside PostgREST's or=(…) and in.(…) lists are quoted, so commas and brackets in them are safe.
const quoted = (s: string) => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
const list = (ids: string[]) => `(${ids.map(quoted).join(',')})`;
const day = (d: string, plus = 0) => new Date(new Date(`${d}T00:00:00`).getTime() + plus * 86_400_000).toISOString();

/** Looks up the people and companies the conditions name. */
async function lookups(supabase: SupabaseClient, f: AuditFilters) {
  return Promise.all(f.rules.map(async (r) => {
    if (r.field === 'user' && r.op !== 'none') {
      const q = supabase.from('profiles').select('id');
      const { data } = await (r.op === 'is' || r.op === 'not' ? q.ilike('email', r.value.replace(/[%_\\]/g, (c) => `\\${c}`)) : q.ilike('email', like(r.value)));
      return (data ?? []).map((u) => u.id as string);
    }
    if (r.field === 'company' && r.op !== 'none') {
      const { data } = await supabase.from('entities').select('id').eq('code', r.value);
      return (data ?? []).map((c) => c.id as string);
    }
    return [];
  }));
}

type Filterable<Q> = {
  eq: (c: string, v: string) => Q; neq: (c: string, v: string) => Q; ilike: (c: string, v: string) => Q; gte: (c: string, v: string) => Q; lt: (c: string, v: string) => Q;
  in: (c: string, v: string[]) => Q; is: (c: string, v: null) => Q; not: (c: string, op: string, v: unknown) => Q; or: (filters: string) => Q;
};
/** Adds every condition; "is not" and "doesn't contain" keep events without a person or company (system events). */
function applyFilters<Q extends Filterable<Q>>(query: Q, f: AuditFilters, found: string[][]) {
  f.rules.forEach((r, i) => {
    const ids = found[i];
    if (r.field === 'action') {
      if (r.op === 'is') query = query.eq('action', r.value);
      if (r.op === 'not') query = query.neq('action', r.value);
      if (r.op === 'has') query = query.ilike('action', like(r.value));
      if (r.op === 'lacks') query = query.not('action', 'ilike', like(r.value));
    }
    if (r.field === 'user' || r.field === 'company') {
      const column = r.field === 'user' ? 'user_id' : 'entity_id';
      if (r.op === 'none') query = query.is(column, null);
      else if (r.op === 'is' || r.op === 'has') query = query.in(column, ids.length ? ids : ['00000000-0000-0000-0000-000000000000']);
      else if (ids.length) query = query.or(`${column}.is.null,${column}.not.in.${list(ids)}`);
    }
    if (r.field === 'date') {
      if (r.op === 'on' || r.op === 'after') query = query.gte('created_at', day(r.value));
      if (r.op === 'on' || r.op === 'before') query = query.lt('created_at', day(r.value, 1));
    }
  });
  return query;
}

/**
 * Builds the filtered audit query. The builder is wrapped because returning a thenable from an async
 * function would run it.
 */
export async function auditQuery(supabase: SupabaseClient, f: AuditFilters) {
  const found = await lookups(supabase, f);
  return { query: applyFilters(supabase.from('audit_log').select('id, action, detail, created_at, user_id, entity_id', { count: 'exact' }).order('created_at', { ascending: false }), f, found) };
}

/** How many events the filters would delete (deletion records excluded). Needs the service key. */
export async function deletableCount(svc: SupabaseClient, f: AuditFilters) {
  const found = await lookups(svc, f);
  const { count } = await applyFilters(svc.from('audit_log').select('id', { count: 'exact', head: true }).neq('action', PROTECTED_ACTION), f, found);
  return count ?? 0;
}

/** Deletes the events the filters match, except deletion records. Needs the service key. */
export async function deleteEvents(svc: SupabaseClient, f: AuditFilters) {
  const found = await lookups(svc, f);
  const { count, error } = await applyFilters(svc.from('audit_log').delete({ count: 'exact' }).neq('action', PROTECTED_ACTION), f, found);
  if (error) throw error;
  return count ?? 0;
}

/** Maps user ids to email addresses for display. */
export async function emailsFor(supabase: SupabaseClient, ids: (string | null)[]) {
  const unique = [...new Set(ids.filter(Boolean))] as string[];
  const { data } = unique.length ? await supabase.from('profiles').select('id, email').in('id', unique) : { data: [] };
  return new Map((data ?? []).map((p) => [p.id, p.email as string]));
}
