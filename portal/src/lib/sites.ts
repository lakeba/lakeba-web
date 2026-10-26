import { PORTAL_DOMAIN } from 'astro:env/server';
import { serviceClient } from './admin';
import { COLUMNS, type Company } from './companies';

/*
 * Venture addresses. With PORTAL_DOMAIN set (investors.lakeba.com), the portal
 * answers on that domain ("central": Lakeba, sign-in, admin) and on
 * {slug}.<domain> for each venture with a full portal. Sign-in always happens
 * on the central address, and the session cookie is shared by all of them, so
 * signing in or out once counts everywhere. A venture can also have its own
 * domain (investors.mist.com) once its DNS is verified: cookies can't be shared
 * with it, so a one-time pass carries the sign-in there (auth/pass, auth/redeem).
 * Any other known address (localhost, the Tailscale name) works as one portal,
 * exactly as before; unknown host names are turned away (known-hosts.mjs).
 */

export type SiteKind = 'central' | 'venture' | 'other';

// Ventures' own domains (verified, full portals), refreshed every minute.
let own = new Map<string, Company>();
let ownAt = 0;
export async function refreshOwnDomains() {
  if (Date.now() - ownAt < 60_000) return;
  ownAt = Date.now();
  const { data } = await serviceClient().from('entities').select(COLUMNS).not('custom_domain', 'is', null).not('custom_domain_verified_at', 'is', null).eq('portal', 'full').neq('relationship', 'group');
  own = new Map(((data ?? []) as Company[]).map((c) => [c.custom_domain!.toLowerCase(), c]));
}
/** The venture whose own domain this is, if verified. */
export const ownDomainVenture = (hostname: string) => own.get(hostname.toLowerCase()) ?? null;

const domain = (PORTAL_DOMAIN ?? '').trim().toLowerCase().replace(/^\.+|\.+$/g, '');

/** Which kind of address a request came to, and the venture's address name. */
export function siteOf(url: URL): { kind: SiteKind; slug: string | null; own?: boolean } {
  const host = url.hostname.toLowerCase();
  const venture = own.get(host);
  if (venture) return { kind: 'venture', slug: venture.slug, own: true };
  if (!domain) return { kind: 'other', slug: null };
  if (host === domain) return { kind: 'central', slug: null };
  const sub = host.endsWith(`.${domain}`) ? host.slice(0, -domain.length - 1) : null;
  return sub && /^[a-z0-9-]+$/.test(sub) ? { kind: 'venture', slug: sub } : { kind: 'other', slug: null };
}

/** The domain the session cookie is shared on; undefined keeps it to this address. */
export const cookieDomain = (url: URL) => { const s = siteOf(url); return s.kind === 'other' || s.own ? undefined : domain; };

const port = (url: URL) => (url.port ? `:${url.port}` : '');
export const centralOrigin = (url: URL) => (domain ? `${url.protocol}//${domain}${port(url)}` : url.origin);
export const ventureOrigin = (url: URL, slug: string) => `${url.protocol}//${slug}.${domain}${port(url)}`;
/** Where a company's portal lives: its venture address, or the central one for Lakeba (and when addresses are off). */
export function siteOriginFor(url: URL, c: Pick<Company, 'relationship' | 'slug'> & Partial<Pick<Company, 'custom_domain' | 'custom_domain_verified_at'>>) {
  if (c.relationship !== 'group' && c.custom_domain && c.custom_domain_verified_at && domain) return `${url.protocol}//${c.custom_domain}${port(url)}`;
  if (siteOf(url).kind === 'other') return url.origin;
  return c.relationship !== 'group' && c.slug ? ventureOrigin(url, c.slug) : centralOrigin(url);
}

/** Whether an absolute address is on a venture's own domain (sign-in gets there with a one-time pass). */
export function isOwnDomainAddress(href: string) {
  try { const u = new URL(href); return /^https?:$/.test(u.protocol) && own.has(u.hostname.toLowerCase()) && !u.username && !u.password; } catch { return false; }
}

/** Whether an absolute address is one of the portal's own (central or a venture), for redirects after sign-in. */
export function isPortalAddress(href: string) {
  if (!domain) return false;
  try {
    const u = new URL(href);
    return /^https?:$/.test(u.protocol) && siteOf(u).kind !== 'other' && !u.username && !u.password;
  } catch {
    return false;
  }
}

/** Address names a venture can't take: they are pages of the portal (investors.lakeba.com/news). */
export const RESERVED_SLUGS = ['www', 'admin', 'api', 'app', 'auth', 'login', 'logout', 'mfa', 'news', 'ask', 'board', 'agm', 'documents', 'portfolio',
  'trading', 'inbox', 'profile', 'account', 'company', 'statement', 'room', 'press', 'go', 'e', 'n', 'mail', 'static', 'assets', 'icons', 'investors', 'lakeba'];

const cache = new Map<string, { at: number; company: Company | null }>();
/** The venture an address name belongs to (full portals only), cached for a minute. */
export async function ventureBySlug(slug: string) {
  const hit = cache.get(slug);
  if (hit && Date.now() - hit.at < 60_000) return hit.company;
  const { data } = await serviceClient().from('entities').select(COLUMNS).eq('slug', slug).eq('portal', 'full').neq('relationship', 'group').maybeSingle();
  const company = (data as Company | null) ?? null;
  cache.set(slug, { at: Date.now(), company });
  return company;
}
/** After a company's address, own domain or portal access changes. */
export const forgetVentureSites = () => { cache.clear(); ownAt = 0; };
