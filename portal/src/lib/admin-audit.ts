import type { SupabaseClient } from '@supabase/supabase-js';

export type AuditFilters = { action: string; email: string; from: string; to: string };

export const readFilters = (params: URLSearchParams): AuditFilters => ({
  action: params.get('action')?.trim() ?? '',
  email: params.get('email')?.trim().toLowerCase() ?? '',
  from: params.get('from') ?? '',
  to: params.get('to') ?? '',
});

/**
 * Builds the filtered audit query; `null` means the email matched nobody.
 * The builder is wrapped because returning a thenable from an async function
 * would run it.
 */
export async function auditQuery(supabase: SupabaseClient, f: AuditFilters) {
  let query = supabase.from('audit_log').select('id, action, detail, created_at, user_id', { count: 'exact' }).order('created_at', { ascending: false });
  if (f.action) query = query.ilike('action', `%${f.action}%`);
  if (f.from) query = query.gte('created_at', new Date(`${f.from}T00:00:00`).toISOString());
  if (f.to) query = query.lt('created_at', new Date(new Date(`${f.to}T00:00:00`).getTime() + 86_400_000).toISOString());
  if (f.email) {
    const { data: users } = await supabase.from('profiles').select('id').ilike('email', `%${f.email}%`);
    if (!users?.length) return null;
    query = query.in('user_id', users.map((u) => u.id));
  }
  return { query };
}

/** Maps user ids to email addresses for display. */
export async function emailsFor(supabase: SupabaseClient, ids: (string | null)[]) {
  const unique = [...new Set(ids.filter(Boolean))] as string[];
  const { data } = unique.length ? await supabase.from('profiles').select('id, email').in('id', unique) : { data: [] };
  return new Map((data ?? []).map((p) => [p.id, p.email as string]));
}
