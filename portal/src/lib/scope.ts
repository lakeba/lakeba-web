import type { SupabaseClient } from '@supabase/supabase-js';

/*
 * The investor pages always show the signed-in person's own view. Row-level
 * security already limits investors to that, but MFA-verified admins can read
 * everything (for the admin area), so these pages filter explicitly too.
 */

/** Holders linked to this login (as owner or viewer). */
export async function myHolderIds(supabase: SupabaseClient, userId: string) {
  const { data } = await supabase.from('holder_members').select('holder_id').eq('user_id', userId);
  return (data ?? []).map((m) => m.holder_id as string);
}

/** PostgREST filter for published documents meant for this person. */
export function myDocumentsFilter(holderIds: string[], role: string | undefined) {
  const parts = ['audience.eq.all_investors'];
  if (role === 'board') parts.push('audience.eq.board');
  if (holderIds.length) parts.push(`and(audience.eq.holder,holder_id.in.(${holderIds.join(',')}))`);
  return parts.join(',');
}

/** Applies the document filter plus "published, not scheduled". */
export function onlyMyDocuments<T extends { or: (f: string) => T; not: (c: string, op: string, v: null) => T; lte: (c: string, v: string) => T }>(
  query: T, holderIds: string[], role: string | undefined,
) {
  return query.or(myDocumentsFilter(holderIds, role)).not('published_at', 'is', null).lte('published_at', new Date().toISOString());
}
