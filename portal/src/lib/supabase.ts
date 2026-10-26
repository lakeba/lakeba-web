import { createServerClient, parseCookieHeader } from '@supabase/ssr';
import type { AstroCookies } from 'astro';
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from 'astro:env/server';
import { cookieDomain, isPortalAddress } from './sites';

/**
 * A per-request Supabase client whose session lives in httpOnly cookies. On
 * venture addresses (sites.ts) the cookies are shared by the central address
 * and every venture; `hostOnly` collects the names of cookies to remove from
 * this address alone (sessions from before addresses were shared).
 */
export function createSupabase({ request, cookies, url }: { request: Request; cookies: AstroCookies; url: URL }, hostOnly?: Set<string>) {
  const domain = cookieDomain(url);
  return createServerClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    cookies: {
      getAll() {
        return parseCookieHeader(request.headers.get('Cookie') ?? '').map(({ name, value }) => ({
          name,
          value: value ?? '',
        }));
      },
      setAll(cookiesToSet) {
        for (const { name, value, options } of cookiesToSet) {
          cookies.set(name, value, { ...options, httpOnly: true, sameSite: 'lax', path: '/', domain });
          if (domain) hostOnly?.add(name);
        }
      },
    },
  });
}

/**
 * Only allow redirects within the portal, to avoid open redirects: a path on
 * this address, or (with venture addresses on) a full address of the portal's own.
 */
export function safeNext(next: string | null | undefined, fallback = '/') {
  if (next && isPortalAddress(next)) return next;
  return next && next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/\\') ? next : fallback;
}
