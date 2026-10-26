import type { AstroCookies } from 'astro';
import type { SupabaseClient } from '@supabase/supabase-js';
import { CATEGORIES } from './notification-events';

/*
 * "View as investor": an admin who also holds shares sees the portal as their
 * investor self, without the Admin tab and admin parts, and only the companies
 * they hold shares in (or sit on the board of). It only takes powers away for
 * this session: the middleware sets their access to none and the database
 * still checks everything as usual. Signing out ends it.
 */

export const VIEW_COOKIE = 'lakeba-view';

export type InvestorView = {
  /** The person has admin powers, so the switch is offered. */
  offered: boolean;
  /** They hold shares somewhere, so it can be switched on. */
  available: boolean;
  /** It is on for this request. */
  on: boolean;
};
export const NO_VIEW: InvestorView = { offered: false, available: false, on: false };

/** Companies this person belongs to as an investor: their shareholdings, and board seats. */
export async function investorCompanyIds(svc: SupabaseClient, userId: string) {
  const today = new Date().toISOString().slice(0, 10);
  const [{ data: held }, { data: seats }] = await Promise.all([
    svc.from('holder_members').select('holders(holdings(shares, share_classes(entity_id)))').eq('user_id', userId),
    svc.from('entity_board').select('entity_id').eq('user_id', userId).or(`ends_on.is.null,ends_on.gte.${today}`),
  ]);
  type Held = { holders: { holdings: { shares: number; share_classes: { entity_id: string } | null }[] } | null };
  const holdings = new Set<string>();
  for (const m of (held ?? []) as unknown as Held[]) {
    for (const h of m.holders?.holdings ?? []) if (Number(h.shares) > 0 && h.share_classes) holdings.add(h.share_classes.entity_id);
  }
  return { holdings, all: new Set([...holdings, ...(seats ?? []).map((s) => s.entity_id as string)]) };
}

export const wantsInvestorView = (cookies: AstroCookies) => cookies.get(VIEW_COOKIE)?.value === 'investor';

/** PostgREST filter value for notifications meant for admins, kept out of sight in the investor view. */
export const ADMIN_KINDS = `(${CATEGORIES.filter((c) => c.audience === 'admin').flatMap((c) => c.kinds).join(',')})`;
