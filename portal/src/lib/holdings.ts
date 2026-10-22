import type { SupabaseClient } from '@supabase/supabase-js';
import { myHolderIds } from './scope';

export type HoldingRow = { shares: number; as_at: string; share_class_id: string; share_classes: { code: string; name: string } | null };
export type HolderWithHoldings = { id: string; name: string; kind: string; registry_ref: string | null; holdings: HoldingRow[] };
export type Position = { holder: HolderWithHoldings; row: HoldingRow; total: number; history: HoldingRow[] };

/** The signed-in user's latest position per holder and class, with history. */
export async function loadPositions(supabase: SupabaseClient, userId: string): Promise<Position[]> {
  return loadHolderPositions(supabase, await myHolderIds(supabase, userId));
}

/** The latest position per holder and class for the given holders, with history. */
export async function loadHolderPositions(supabase: SupabaseClient, ids: string[]): Promise<Position[]> {
  if (!ids.length) return [];
  const [{ data: holders }, { data: onIssue }] = await Promise.all([
    supabase.from('holders').select('id, name, kind, registry_ref, holdings(shares, as_at, share_class_id, share_classes(code, name))').in('id', ids).order('name'),
    supabase.rpc('shares_on_issue'),
  ]);
  const totals = new Map<string, number>((onIssue ?? []).map((r: { share_class_id: string; total: number }) => [r.share_class_id, Number(r.total)]));
  return ((holders ?? []) as unknown as HolderWithHoldings[]).flatMap((holder) => {
    const byClass = new Map<string, HoldingRow[]>();
    for (const row of holder.holdings) byClass.set(row.share_class_id, [...(byClass.get(row.share_class_id) ?? []), row]);
    return [...byClass.values()].map((rows) => {
      const history = rows.sort((a, b) => a.as_at.localeCompare(b.as_at));
      const row = history[history.length - 1];
      return { holder, row, total: totals.get(row.share_class_id) ?? 0, history };
    });
  });
}

/** The latest reference price per share class. */
export async function latestPrices(supabase: SupabaseClient): Promise<Map<string, Price>> {
  const { data } = await supabase.from('reference_prices').select('share_class_id, price, priced_on, source, note').order('priced_on', { ascending: false });
  const latest = new Map<string, Price>();
  for (const { share_class_id, ...p } of data ?? []) if (!latest.has(share_class_id)) latest.set(share_class_id, { ...p, price: Number(p.price) });
  return latest;
}

export type Price = { price: number; priced_on: string; source: string; note: string | null };

export async function loadPrices(supabase: SupabaseClient, shareClassId: string): Promise<Price[]> {
  const { data } = await supabase.from('reference_prices').select('price, priced_on, source, note').eq('share_class_id', shareClassId).order('priced_on');
  return (data ?? []).map((p) => ({ ...p, price: Number(p.price) }));
}

export const sourceLabels: Record<string, string> = { capital_raise: 'Capital raise', secondary_trade: 'Secondary trade', valuation: 'Directors’ valuation' };
