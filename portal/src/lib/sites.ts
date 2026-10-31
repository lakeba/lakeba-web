import { PORTAL_DOMAIN } from 'astro:env/server';
import { serviceClient } from './admin';
import { COLUMNS, type Company } from './companies';

/*
 * The portal's addresses. Every company is on the central address
 * (PORTAL_DOMAIN, investors.lakeba.com): Lakeba, every venture (chosen with
 * the company switcher), sign-in, two-step and admin. A venture can also have
 * its own domain (investors.mist.com) once its DNS points here: its investors
 * open its portal there. Cookies can't be shared with another domain, so a
 * one-time pass carries the sign-in across (auth/pass, auth/redeem), only for
 * people who belong to that venture alone. Without PORTAL_DOMAIN there are no
 * own domains. Any other known address (localhost, the Tailscale name) works
 * as one portal; unknown host names are turned away (known-hosts.mjs).
 */

export type SiteKind = 'central' | 'venture' | 'crm' | 'other';

// Ventures' own domains (verified, full portals), refreshed every minute.
let own = new Map<string, Company>();
let ownAt = 0;
export async function refreshOwnDomains() {
  if (Date.now() - ownAt < 60_000) return;
  ownAt = Date.now();
  const { data } = await serviceClient().from('entities').select(COLUMNS).not('custom_domain', 'is', null).not('custom_domain_verified_at', 'is', null).eq('portal', 'full').neq('relationship', 'group');
  own = new Map(((data ?? []) as Company[]).map((c) => [c.custom_domain!.toLowerCase(), c]));
  // CRM addresses (crm.doxai.com): verified, with the CRM switched on (lib/crm.ts).
  const { data: crm } = await serviceClient().from('entities').select('id, code, display_name, crm_domain').not('crm_domain', 'is', null).not('crm_domain_verified_at', 'is', null).eq('crm_enabled', true);
  crmByHost = new Map(((crm ?? []) as (CrmVenture & { crm_domain: string })[]).map(({ crm_domain, ...c }) => [crm_domain.toLowerCase(), c]));
}
let crmByHost = new Map<string, CrmVenture>();
export type CrmVenture = { id: string; code: string; display_name: string };
/** The venture whose CRM address this is (crm.doxai.com), if verified and the CRM is on. */
export const crmDomainVenture = (hostname: string) => (domain ? crmByHost.get(hostname.toLowerCase()) ?? null : null);
/** The venture whose own domain this is, if verified. */
export const ownDomainVenture = (hostname: string) => (domain ? own.get(hostname.toLowerCase()) ?? null : null);

const domain = (PORTAL_DOMAIN ?? '').trim().toLowerCase().replace(/^\.+|\.+$/g, '');

/** Which kind of address a request came to: the central one, a venture's own domain, or another known one. */
export function siteOf(url: URL): { kind: SiteKind; slug: string | null; own?: boolean } {
  const host = url.hostname.toLowerCase();
  const venture = ownDomainVenture(host);
  if (venture) return { kind: 'venture', slug: venture.slug, own: true };
  if (crmDomainVenture(host)) return { kind: 'crm', slug: null, own: true };
  return domain && host === domain ? { kind: 'central', slug: null } : { kind: 'other', slug: null };
}

const port = (url: URL) => (url.port ? `:${url.port}` : '');
export const centralOrigin = (url: URL) => (domain ? `${url.protocol}//${domain}${port(url)}` : url.origin);
/** Where a company's portal opens: its own domain once verified, else the central address. */
export function siteOriginFor(url: URL, c: Pick<Company, 'relationship'> & Partial<Pick<Company, 'custom_domain' | 'custom_domain_verified_at'>>) {
  if (c.relationship !== 'group' && c.custom_domain && c.custom_domain_verified_at && domain) return `${url.protocol}//${c.custom_domain}${port(url)}`;
  return centralOrigin(url);
}

/** Whether an absolute address is on a venture's own domain (sign-in gets there with a one-time pass). */
export function isOwnDomainAddress(href: string) {
  try { const u = new URL(href); return /^https?:$/.test(u.protocol) && Boolean(ownDomainVenture(u.hostname)) && !u.username && !u.password; } catch { return false; }
}

/** Whether an absolute address is the central one, for redirects after sign-in (own domains go through a pass). */
export function isPortalAddress(href: string) {
  if (!domain) return false;
  try {
    const u = new URL(href);
    return /^https?:$/.test(u.protocol) && u.hostname.toLowerCase() === domain && !u.username && !u.password;
  } catch {
    return false;
  }
}

/** Short names a venture can't take (they read like pages of the portal). */
export const RESERVED_SLUGS = ['www', 'admin', 'api', 'app', 'auth', 'login', 'logout', 'mfa', 'news', 'ask', 'board', 'agm', 'documents', 'portfolio',
  'trading', 'inbox', 'profile', 'account', 'company', 'statement', 'room', 'press', 'go', 'e', 'n', 'mail', 'static', 'assets', 'icons', 'investors', 'lakeba'];

const cache = new Map<string, { at: number; company: Company | null }>();
/** The venture a short name belongs to (full portals only), for its branded sign-in page (/login?venture=mist); cached for a minute. */
export async function ventureBySlug(slug: string) {
  const hit = cache.get(slug);
  if (hit && Date.now() - hit.at < 60_000) return hit.company;
  const { data } = await serviceClient().from('entities').select(COLUMNS).eq('slug', slug).eq('portal', 'full').neq('relationship', 'group').maybeSingle();
  const company = (data as Company | null) ?? null;
  cache.set(slug, { at: Date.now(), company });
  return company;
}
/** After a company's short name, own domain or portal access changes. */
export const forgetVentureSites = () => { cache.clear(); ownAt = 0; };
