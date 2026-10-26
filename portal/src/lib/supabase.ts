import { createServerClient, parseCookieHeader } from '@supabase/ssr';
import type { AstroCookies } from 'astro';
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from 'astro:env/server';
import { isOwnDomainAddress, isPortalAddress } from './sites';

/**
 * A per-request Supabase client whose session lives in httpOnly cookies, on
 * this address only (a venture's own domain gets its own, through a one-time pass).
 */
export function createSupabase({ request, cookies }: { request: Request; cookies: AstroCookies }) {
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
          cookies.set(name, value, { ...options, httpOnly: true, sameSite: 'lax', path: '/' });
        }
      },
    },
  });
}

/**
 * Only allow redirects within the portal, to avoid open redirects: a path on
 * this address, or the central address.
 * A venture's own domain is reached through a one-time pass (it can't share the session cookie).
 */
export function safeNext(next: string | null | undefined, fallback = '/') {
  if (next && isOwnDomainAddress(next)) return `/auth/pass?to=${encodeURIComponent(next)}`;
  if (next && isPortalAddress(next)) return next;
  return next && next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/\\') ? next : fallback;
}
