import type { SupabaseClient } from '@supabase/supabase-js';
import type { Access } from './access';
import { AREAS } from './permissions';
import { serviceClient } from './admin';
import type { Locale } from './i18n';

/*
 * Announcements (Admin → Communications → Announcements): a banner on the dashboard (shareholders) or the
 * admin Overview (staff) while live, and, if chosen, a pop-up each person sees once (components/Tour.astro)
 * the first time they open that page while it's live. A guided tour waiting for them goes first.
 */

export type Audience = 'investors' | 'staff' | 'everyone';
export type Translation = { title?: string; body?: string; link_label?: string };
export type Announcement = {
  id: string; entity_id: string; title: string; body: string | null; link_url: string | null; link_label: string | null; tone: string;
  audience: Audience; staff_area: string | null; point_at: string | null; translations: Partial<Record<Locale, Translation>>; popup: boolean;
  starts_at: string; ends_at: string | null;
};
export const COLUMNS = 'id, entity_id, title, body, link_url, link_label, tone, audience, staff_area, point_at, translations, popup, starts_at, ends_at';
export const AUDIENCES: [Audience, string][] = [['investors', 'Shareholders'], ['staff', 'Staff'], ['everyone', 'Shareholders and staff']];
/** The pop-up's small heading by style (translated for shareholders). */
export const TONE_LABELS: Record<string, string> = { info: 'Announcement', success: 'Good news', warning: 'Important' };

/** Title, text and button in the person's language, where the announcement has them. */
export const localised = (a: Pick<Announcement, 'title' | 'body' | 'link_label' | 'translations'>, locale: Locale) => {
  const tr = locale === 'en' ? {} : a.translations?.[locale] ?? {};
  return { title: tr.title?.trim() || a.title, body: tr.body?.trim() || a.body, link_label: tr.link_label?.trim() || a.link_label };
};

/** Whether someone's roles cover a staff announcement (its section, or any section, for its company). */
export const staffSees = (access: Access, a: Pick<Announcement, 'entity_id' | 'staff_area'>) =>
  a.staff_area ? access.can(`${a.staff_area}.view`, a.entity_id) : AREAS.some((x) => access.can(`${x.key}.view`, a.entity_id));

const live = <Q extends { lte: (c: string, v: string) => Q; or: (f: string) => Q }>(q: Q) => {
  const now = new Date().toISOString();
  return q.lte('starts_at', now).or(`ends_at.is.null,ends_at.gt.${now}`);
};

/** Live staff announcements this person's roles cover, for the admin Overview's banner. */
export async function staffBanners(access: Access) {
  const { data } = await live(serviceClient().from('announcements').select(COLUMNS).in('audience', ['staff', 'everyone'])).order('starts_at', { ascending: false }).limit(20);
  return ((data ?? []) as Announcement[]).filter((a) => staffSees(access, a)).slice(0, 3);
}

/** The pop-up for this person on this page (the dashboard or the admin Overview), if one waits for them. */
export async function popupFor(locals: App.Locals, path: string) {
  const audiences = path === '/' ? ['investors', 'everyone'] : path === '/admin' ? ['staff', 'everyone'] : null;
  if (!audiences || !locals.user) return null;
  if (path === '/' && (locals.viewMode.mode === 'admin' || !locals.company)) return null;
  const svc = serviceClient();
  const { data } = await live(svc.from('announcements').select(COLUMNS).eq('popup', true).in('audience', audiences)).order('starts_at', { ascending: false }).limit(20);
  const list = (data ?? []) as Announcement[];
  if (!list.length) return null;
  const { data: seen } = await svc.from('announcement_views').select('announcement_id').eq('user_id', locals.user.id).in('announcement_id', list.map((a) => a.id));
  const done = new Set((seen ?? []).map((s) => s.announcement_id as string));
  return list.find((a) => !done.has(a.id) && (path === '/' ? a.entity_id === locals.company!.id : staffSees(locals.access, a))) ?? null;
}

/** Shareholders of a company (accounts linked to a holding entity with shares in it). */
async function shareholdersOf(svc: SupabaseClient, entityId: string) {
  const { data } = await svc.from('holder_members').select('user_id, holders!inner(holdings!inner(shares, share_classes!inner(entity_id)))')
    .gt('holders.holdings.shares', 0).eq('holders.holdings.share_classes.entity_id', entityId).limit(100_000);
  return new Set((data ?? []).map((m) => m.user_id as string));
}

/** Staff whose roles cover a company (and a section, if given). Group admins always count. */
async function staffOf(svc: SupabaseClient, entityId: string, area: string | null) {
  let keys: string[] | null = null;
  if (area) {
    const { data } = await svc.from('role_permissions').select('role_key').like('permission', `${area}.%`);
    keys = [...new Set(['admin', ...(data ?? []).map((r) => r.role_key as string)])];
  }
  let q = svc.from('user_roles').select('user_id').or(`entity_id.is.null,entity_id.eq.${entityId}`).or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`);
  if (keys) q = q.in('role_key', keys);
  const { data } = await q.limit(100_000);
  return new Set((data ?? []).map((r) => r.user_id as string));
}

/** For each pop-up: how many of the people it's for have seen it. */
export async function reach(svc: SupabaseClient, list: Announcement[]) {
  const popups = list.filter((a) => a.popup);
  const out = new Map<string, { seen: number; total: number }>();
  if (!popups.length) return out;
  const { data: views } = await svc.from('announcement_views').select('announcement_id, user_id').in('announcement_id', popups.map((a) => a.id)).limit(100_000);
  await Promise.all(popups.map(async (a) => {
    const people = new Set<string>();
    if (a.audience !== 'staff') for (const id of await shareholdersOf(svc, a.entity_id)) people.add(id);
    if (a.audience !== 'investors') for (const id of await staffOf(svc, a.entity_id, a.staff_area)) people.add(id);
    const seen = (views ?? []).filter((v) => v.announcement_id === a.id && people.has(v.user_id as string)).length;
    out.set(a.id, { seen, total: people.size });
  }));
  return out;
}
