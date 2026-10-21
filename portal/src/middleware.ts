import { defineMiddleware } from 'astro:middleware';
import { createSupabase } from './lib/supabase';

/** Pages reachable without signing in. */
const PUBLIC_PATHS = ['/login', '/forgot-password', '/auth/confirm'];
/** Pages a signed-in user can reach before finishing MFA. */
const MFA_PATHS = ['/mfa/verify', '/mfa/setup', '/logout'];

const matches = (path: string, list: string[]) => list.some((p) => path === p || path.startsWith(`${p}/`));

export const onRequest = defineMiddleware(async (context, next) => {
  const { url, locals, redirect } = context;
  const path = url.pathname;
  locals.supabase = createSupabase(context);
  locals.user = null;
  locals.profile = null;
  locals.mfaEnrolled = false;

  // getClaims() validates the JWT signature rather than trusting the cookie.
  const { data } = await locals.supabase.auth.getClaims();
  const claims = data?.claims;
  if (claims) {
    locals.user = { id: claims.sub, email: String(claims.email ?? ''), aal: claims.aal === 'aal2' ? 'aal2' : 'aal1' };
  }

  if (!locals.user) {
    if (matches(path, PUBLIC_PATHS)) return withSecurityHeaders(await next());
    return redirect(`/login?next=${encodeURIComponent(path + url.search)}`);
  }

  const { data: aal } = await locals.supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  locals.mfaEnrolled = aal?.nextLevel === 'aal2';

  // Enrolled users must complete MFA for this session before anything else.
  if (locals.mfaEnrolled && locals.user.aal !== 'aal2' && !matches(path, MFA_PATHS)) {
    return redirect(`/mfa/verify?next=${encodeURIComponent(path + url.search)}`);
  }

  const { data: profile } = await locals.supabase
    .from('profiles')
    .select('email, first_name, last_name, role')
    .eq('id', locals.user.id)
    .single();
  locals.profile = profile;

  // Admins cannot use the portal until they have enrolled MFA.
  if (profile?.role === 'admin' && !locals.mfaEnrolled && !matches(path, MFA_PATHS)) {
    return redirect('/mfa/setup?required=1');
  }

  if (matches(path, ['/admin']) && !(profile?.role === 'admin' && locals.user.aal === 'aal2')) {
    return new Response('Forbidden', { status: 403 });
  }

  if (matches(path, ['/login', '/forgot-password'])) return redirect('/');

  return withSecurityHeaders(await next());
});

function withSecurityHeaders(response: Response) {
  const h = response.headers;
  h.set('X-Frame-Options', 'DENY');
  h.set('X-Content-Type-Options', 'nosniff');
  h.set('Referrer-Policy', 'same-origin');
  h.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  // Portal pages carry personal data: never cache them.
  h.set('Cache-Control', 'no-store');
  return response;
}
