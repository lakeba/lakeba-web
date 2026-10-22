import type { SupabaseClient } from '@supabase/supabase-js';
import type { Company } from './companies';

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

/** Is this person on the board of this company? (Group board = role 'board'; others via entity_board.) */
export async function onBoardOf(supabase: SupabaseClient, userId: string, company: Company | null, role: string | undefined) {
  if (!company) return false;
  if (company.relationship === 'group') return role === 'board';
  const { data } = await supabase.from('entity_board').select('entity_id').eq('user_id', userId).eq('entity_id', company.id)
    .or(`ends_on.is.null,ends_on.gte.${new Date().toISOString().slice(0, 10)}`).limit(1);
  return Boolean(data?.length);
}

/** PostgREST filter for published documents meant for this person. */
export function myDocumentsFilter(holderIds: string[], onBoard: boolean) {
  const parts = ['audience.eq.all_investors'];
  if (onBoard) parts.push('audience.eq.board');
  if (holderIds.length) parts.push(`and(audience.eq.holder,holder_id.in.(${holderIds.join(',')}))`);
  return parts.join(',');
}

/** The company's own documents; the group also shows venture documents shared with it. */
export function companyDocumentsFilter(company: Company) {
  return company.relationship === 'group' ? `entity_id.eq.${company.id},shared_with_group.eq.true` : `entity_id.eq.${company.id}`;
}

type DocQuery<T> = { or: (f: string) => T; not: (c: string, op: string, v: null) => T; lte: (c: string, v: string) => T };

/** Published documents of the company being viewed that are meant for this person. */
export function onlyMyDocuments<T extends DocQuery<T>>(query: T, { holderIds, onBoard, company }: { holderIds: string[]; onBoard: boolean; company: Company | null }) {
  // Two .or() filters are combined with AND by PostgREST.
  const scoped = query.or(myDocumentsFilter(holderIds, onBoard)).or(company ? companyDocumentsFilter(company) : 'entity_id.is.null');
  return scoped.not('published_at', 'is', null).lte('published_at', new Date().toISOString());
}
