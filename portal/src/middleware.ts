import { defineMiddleware } from 'astro:middleware';
import { createSupabase } from './lib/supabase';
import { loadCompanyContext } from './lib/companies';
import { NO_ACCESS, adminMayRequest, formAction, loadAccess } from './lib/access';
import { rememberOrigin, startNotificationWorker } from './lib/notify-jobs';
import { serviceClient } from './lib/admin';
import { tradingEnabled } from './lib/trading';
import { INTL, fromAcceptLanguage, isLocale, translator, type Locale } from './lib/i18n';
import { formats } from './lib/format';

// Sends queued browser notifications and runs scheduled ones (reminders, daily summaries).
startNotificationWorker();

/** Pages reachable without signing in. */
const PUBLIC_PATHS = ['/press', '/login', '/forgot-password', '/auth/confirm', '/go', '/passkey-login', '/e', '/room', '/news-media', '/api/public', '/n', '/favicon.ico'];
/** Pages a signed-in user can reach before finishing MFA. */
const MFA_PATHS = ['/mfa/verify', '/mfa/setup', '/logout', '/go', '/passkey-login'];

const matches = (path: string, list: string[]) => list.some((p) => path === p || path.startsWith(`${p}/`));

export const onRequest = defineMiddleware(async (context, next) => {
  const { url, locals, redirect } = context;
  const path = url.pathname;
  rememberOrigin(url.origin);
  locals.supabase = createSupabase(context);
  locals.user = null;
  locals.profile = null;
  locals.mfaEnrolled = false;
  locals.companies = [];
  locals.company = null;
  locals.group = null;
  locals.adminOf = [];
  locals.access = NO_ACCESS;
  locals.writing = !['GET', 'HEAD'].includes(context.request.method);
  locals.features = { ask: false, boardQa: false, trading: false };
  // Language: ?lang= (remembered in a cookie), else the cookie, else the browser; the profile choice wins once signed in.
  const asked = url.searchParams.get('lang');
  if (isLocale(asked)) context.cookies.set('lang', asked, { path: '/', maxAge: 31_536_000, sameSite: 'lax', secure: url.protocol === 'https:', httpOnly: true });
  const setLocale = (l: Locale) => { locals.locale = l; locals.t = translator(l); locals.fmt = formats(INTL[l]); };
  const cookieLang = context.cookies.get('lang')?.value;
  setLocale(isLocale(asked) ? asked : isLocale(cookieLang) ? cookieLang : fromAcceptLanguage(context.request.headers.get('accept-language')) ?? 'en');

  // getClaims() validates the JWT signature rather than trusting the cookie.
  const { data } = await locals.supabase.auth.getClaims();
  const claims = data?.claims;
  if (claims) {
    const codeVerified = claims.aal === 'aal2';
    // A passkey sign-in where the device checked the person counts as two-step (see passkey_sessions).
    const usedPasskey = !codeVerified && (claims.amr as { method: string }[] | undefined)?.some((a) => a.method === 'passkey');
    const passkeyVerified = usedPasskey ? (await locals.supabase.rpc('session_is_strong')).data === true : false;
    locals.user = {
      id: claims.sub, email: String(claims.email ?? ''), aal: codeVerified || passkeyVerified ? 'aal2' : 'aal1',
      strongBy: codeVerified ? 'code' : passkeyVerified ? 'passkey' : null, codeVerified,
    };
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
    .select('email, first_name, last_name, role, locale')
    .eq('id', locals.user.id)
    .single();
  locals.profile = profile;
  if (isLocale(profile?.locale) && !isLocale(asked)) setLocale(profile.locale);

  const companyContext = await loadCompanyContext(locals.supabase, context.cookies);
  locals.companies = companyContext.companies;
  locals.company = companyContext.current;
  locals.group = companyContext.group;
  locals.adminOf = companyContext.adminOf;
  // Roles (System → Users); their permissions count only after two-step, like the database's can().
  locals.access = await loadAccess(serviceClient(), locals.user.id, locals.user.aal === 'aal2');
  const { data: flags } = await locals.supabase.rpc('my_portal_flags').maybeSingle();
  locals.features = {
    ask: (flags as { ask_enabled?: boolean } | null)?.ask_enabled ?? true,
    boardQa: (flags as { board_qa_enabled?: boolean } | null)?.board_qa_enabled ?? true,
    trading: locals.company ? await tradingEnabled(serviceClient(), locals.company.id) : false,
  };

  // Anyone with a staff role cannot use the portal until they have enrolled MFA.
  if (locals.access.staff && !locals.mfaEnrolled && !matches(path, MFA_PATHS)) {
    return redirect('/mfa/setup?required=1');
  }

  // Every admin request: "see" for the page's area, "do" (or an approval action) to send a form.
  if (matches(path, ['/admin'])) {
    const form = locals.writing && !locals.access.groupAdmin && /form/.test(context.request.headers.get('content-type') ?? '') ? await context.request.clone().formData().catch(() => null) : null;
    if (!adminMayRequest(locals.access, path, locals.writing, formAction(form))) return new Response('Forbidden', { status: 403 });
  }

  if (matches(path, ['/login', '/forgot-password'])) return redirect('/');

  return withSecurityHeaders(await next());
});

function withSecurityHeaders(response: Response) {
  const h = response.headers;
  // Never shown inside other sites' frames; a route may allow the portal's own (newsletter previews).
  if (h.get('X-Frame-Options') !== 'SAMEORIGIN') h.set('X-Frame-Options', 'DENY');
  h.set('X-Content-Type-Options', 'nosniff');
  h.set('Referrer-Policy', 'same-origin');
  h.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  // Portal pages carry personal data: never cache them. Routes may opt into
  // private (browser-only) caching, e.g. company logos.
  if (!h.get('Cache-Control')?.startsWith('private')) h.set('Cache-Control', 'no-store');
  return response;
}
