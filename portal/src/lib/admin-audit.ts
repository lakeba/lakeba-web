import type { SupabaseClient } from '@supabase/supabase-js';

export type AuditFilters = { action: string; email: string; from: string; to: string };

export const readFilters = (params: URLSearchParams): AuditFilters => ({
  action: params.get('action')?.trim() ?? '',
  email: params.get('email')?.trim().toLowerCase() ?? '',
  from: params.get('from') ?? '',
  to: params.get('to') ?? '',
});

/** Records of deletions themselves: never deleted, so trimming the log always leaves a trace. */
export const PROTECTED_ACTION = 'audit_log_deleted';

/** The people whose events the email filter means; `null` when it matches nobody. */
async function usersFor(supabase: SupabaseClient, f: AuditFilters) {
  if (!f.email) return undefined;
  const { data: users } = await supabase.from('profiles').select('id').ilike('email', `%${f.email}%`);
  return users?.length ? users.map((u) => u.id as string) : null;
}

type Filterable<Q> = { ilike: (c: string, v: string) => Q; gte: (c: string, v: string) => Q; lt: (c: string, v: string) => Q; in: (c: string, v: string[]) => Q };
function applyFilters<Q extends Filterable<Q>>(query: Q, f: AuditFilters, userIds: string[] | undefined) {
  if (f.action) query = query.ilike('action', `%${f.action}%`);
  if (f.from) query = query.gte('created_at', new Date(`${f.from}T00:00:00`).toISOString());
  if (f.to) query = query.lt('created_at', new Date(new Date(`${f.to}T00:00:00`).getTime() + 86_400_000).toISOString());
  if (userIds) query = query.in('user_id', userIds);
  return query;
}

/**
 * Builds the filtered audit query; `null` means the email matched nobody.
 * The builder is wrapped because returning a thenable from an async function
 * would run it.
 */
export async function auditQuery(supabase: SupabaseClient, f: AuditFilters) {
  const userIds = await usersFor(supabase, f);
  if (userIds === null) return null;
  return { query: applyFilters(supabase.from('audit_log').select('id, action, detail, created_at, user_id', { count: 'exact' }).order('created_at', { ascending: false }), f, userIds) };
}

/** How many events the filters would delete (deletion records excluded). Needs the service key. */
export async function deletableCount(svc: SupabaseClient, f: AuditFilters) {
  const userIds = await usersFor(svc, f);
  if (userIds === null) return 0;
  const { count } = await applyFilters(svc.from('audit_log').select('id', { count: 'exact', head: true }).neq('action', PROTECTED_ACTION), f, userIds);
  return count ?? 0;
}

/** Deletes the events the filters match, except deletion records. Needs the service key. */
export async function deleteEvents(svc: SupabaseClient, f: AuditFilters) {
  const userIds = await usersFor(svc, f);
  if (userIds === null) return 0;
  const { count, error } = await applyFilters(svc.from('audit_log').delete({ count: 'exact' }).neq('action', PROTECTED_ACTION), f, userIds);
  if (error) throw error;
  return count ?? 0;
}

/** Maps user ids to email addresses for display. */
export async function emailsFor(supabase: SupabaseClient, ids: (string | null)[]) {
  const unique = [...new Set(ids.filter(Boolean))] as string[];
  const { data } = unique.length ? await supabase.from('profiles').select('id, email').in('id', unique) : { data: [] };
  return new Map((data ?? []).map((p) => [p.id, p.email as string]));
}
