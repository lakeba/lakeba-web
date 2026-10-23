import type { SupabaseClient } from '@supabase/supabase-js';
import { myHolderIds } from './scope';

/*
 * The "There's a note on one of your holdings" banner. It lists notes on the
 * signed-in person's own holdings (not every note an admin can read) that they
 * haven't closed; closing is remembered per note version, so a new or
 * changed note brings the banner back.
 */
export type PendingNote = { holderId: string; classId: string; holder: string; className: string; companyCode: string | null; updatedAt: string };

export async function pendingNotes(supabase: SupabaseClient, userId: string): Promise<PendingNote[]> {
  const holderIds = await myHolderIds(supabase, userId);
  if (!holderIds.length) return [];
  const [{ data: notes }, { data: closed }] = await Promise.all([
    supabase.from('holding_notes').select('holder_id, share_class_id, updated_at, holders(name), share_classes(name, entities(code))').in('holder_id', holderIds),
    supabase.from('holding_note_dismissals').select('holder_id, share_class_id, note_updated_at').eq('user_id', userId),
  ]);
  const closedAt = new Map((closed ?? []).map((c) => [`${c.holder_id}|${c.share_class_id}`, c.note_updated_at as string]));
  return (notes ?? [])
    .filter((n) => { const at = closedAt.get(`${n.holder_id}|${n.share_class_id}`); return !at || new Date(at) < new Date(n.updated_at); })
    .map((n) => {
      const cls = n.share_classes as unknown as { name: string; entities: { code: string } | null } | null;
      return { holderId: n.holder_id, classId: n.share_class_id, holder: (n.holders as unknown as { name: string } | null)?.name ?? '', className: cls?.name ?? '', companyCode: cls?.entities?.code ?? null, updatedAt: n.updated_at };
    });
}

/** Where a holding's card is on the dashboard. */
export const holdingAnchor = (holderId: string, classId: string) => `holding-${holderId}-${classId}`;
