import type { AstroCookies } from 'astro';
import type { SupabaseClient } from '@supabase/supabase-js';
import { CATEGORIES } from './notification-events';

/*
 * Views of the portal for people who work in it (docs/two-addresses-plan.md, step 0):
 * - All (where everyone starts): every menu, the shareholder ones and the work ones.
 * - Admin: the work menus only (Admin, To sign, My HR); home opens the person's work page.
 * - Investor (for those who hold shares): the shareholder menus only, with their admin powers set
 *   aside: the middleware sets their access to none and the database still checks everything as usual.
 * They switch in the profile menu, remembered in a cookie. In the admin or investor view, opening the
 * other side's page by a link switches to that side. Shareholders with no work only ever see the
 * investor side. The page lists below become the route map of the two addresses (step 1).
 */

export const VIEW_COOKIE = 'lakeba-view';

export type Side = 'admin' | 'investor';
export type Mode = 'all' | Side;
/** Work in the portal: admin pages, directors' papers to sign, My HR. */
export type Work = { admin: boolean; toSign: number; waiting: number; hr: boolean };
export type ViewMode = {
  mode: Mode;
  work: Work;
  /** Work in the portal, so the switch is offered. */
  offered: boolean;
  /** Shares somewhere, so the investor view is one of the choices. */
  investor: boolean;
  /** The investor view for someone who also works in the portal: their admin powers are set aside. */
  on: boolean;
};
export const NO_WORK: Work = { admin: false, toSign: 0, waiting: 0, hr: false };
export const NO_VIEW: ViewMode = { mode: 'investor', work: NO_WORK, offered: false, investor: true, on: false };

/** Pages of each side; the others (account, inbox, company switch…) belong to both. "/" is home of the investor side. */
export const WORK_PATHS = ['/admin', '/api/admin', '/sign', '/my-hr'];
export const INVESTOR_PATHS = ['/documents', '/portfolio', '/agm', '/news', '/ask', '/board', '/trading', '/statement'];
const under = (path: string, list: string[]) => list.some((p) => path === p || path.startsWith(`${p}/`));
export const sideOf = (path: string): Side | null => (under(path, WORK_PATHS) ? 'admin' : path === '/' || under(path, INVESTOR_PATHS) ? 'investor' : null);

export const hasWork = (w: Work) => w.admin || w.toSign > 0 || w.hr;
/** Where admin mode opens: the admin, else papers to sign, else My HR. */
export const workHome = (w: Work) => (w.admin ? '/admin' : w.toSign ? '/sign' : w.hr ? '/my-hr' : '/');

/** The person's work in the portal (`admin`: their roles open the admin). */
export async function workOf(svc: SupabaseClient, userId: string, admin: boolean): Promise<Work> {
  const [{ data: toSign }, { count: employments }] = await Promise.all([
    svc.from('board_signatures').select('status, board_papers!inner(status)').eq('user_id', userId).in('board_papers.status', ['signing', 'signed']),
    svc.from('people').select('id', { count: 'exact', head: true }).eq('user_id', userId).neq('status', 'left'),
  ]);
  const waiting = (toSign ?? []).filter((s) => s.status === 'pending' && (s.board_papers as unknown as { status: string }).status === 'signing').length;
  return { admin, toSign: toSign?.length ?? 0, waiting, hr: Boolean(employments) };
}

export const isMode = (v: unknown): v is Mode => v === 'all' || v === 'admin' || v === 'investor';
export const chosenMode = (cookies: AstroCookies): Mode | null => {
  const v = cookies.get(VIEW_COOKIE)?.value;
  return isMode(v) ? v : null;
};
/** Remembered across visits and sign-ins: it only chooses menus, never grants anything. */
export const rememberMode = (cookies: AstroCookies, mode: Mode, secure: boolean) =>
  cookies.set(VIEW_COOKIE, mode, { path: '/', maxAge: 31_536_000, sameSite: 'lax', secure, httpOnly: true });

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

/** PostgREST filter value for notifications meant for admins, kept out of sight in the investor view. */
export const ADMIN_KINDS = `(${CATEGORIES.filter((c) => c.audience === 'admin').flatMap((c) => c.kinds).join(',')})`;
