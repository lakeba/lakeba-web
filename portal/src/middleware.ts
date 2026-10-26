import { defineMiddleware } from 'astro:middleware';
import { createSupabase, safeNext } from './lib/supabase';
import { loadCompanyContext } from './lib/companies';
import { NO_ACCESS, adminMayRequest, formAction, loadAccess } from './lib/access';
import { rememberOrigin, startNotificationWorker } from './lib/notify-jobs';
import { serviceClient } from './lib/admin';
import { tradingEnabled } from './lib/trading';
import { INTL, fromAcceptLanguage, isLocale, translator, type Locale } from './lib/i18n';
import { formats } from './lib/format';
import { RESERVED_SLUGS, centralOrigin, cookieDomain, ownDomainVenture, refreshOwnDomains, siteOf, siteOriginFor, ventureBySlug, ventureOrigin } from './lib/sites';
import { isKnownHost } from './lib/known-hosts.mjs';

// Sends queued browser notifications and runs scheduled ones (reminders, daily summaries).
startNotificationWorker();

/** Pages reachable without signing in. */
const PUBLIC_PATHS = ['/press', '/login', '/forgot-password', '/auth/confirm', '/auth/redeem', '/auth/ms-consent', '/go', '/passkey-login', '/e', '/room', '/news-media', '/api/public', '/api/v1', '/embed', '/n', '/favicon.ico'];
/** Pages a signed-in user can reach before finishing MFA. */
const MFA_PATHS = ['/mfa/verify', '/mfa/setup', '/logout', '/go', '/passkey-login'];

/** On a venture's address, these open on the central one (sign-in, two-step, passkeys and admin live there). */
const CENTRAL_PATHS = ['/login', '/forgot-password', '/passkey-login', '/mfa', '/account/security', '/api/passkeys', '/admin', '/auth/pass'];
/** Set once a session has been moved onto the cookies shared by all the portal's addresses. */
const SHARED_COOKIE = 'lakeba-shared-session';

const matches = (path: string, list: string[]) => list.some((p) => path === p || path.startsWith(`${p}/`));

export const onRequest = defineMiddleware(async (context, next) => {
  const { url, locals, redirect } = context;
  const path = url.pathname;
  // Ventures' own domains are let through by Astro with any other HTTPS name: turn away all but those.
  await refreshOwnDomains();
  if (!isKnownHost(url.hostname) && !ownDomainVenture(url.hostname)) return new Response('Not found', { status: 404 });
  rememberOrigin(url.origin);
  const site = siteOf(url);
  const hostOnly = new Set<string>();
  const done = (response: Response) => withSecurityHeaders(clearHostOnly(response, hostOnly));
  locals.supabase = createSupabase(context, hostOnly);
  locals.site = { kind: site.kind, venture: null, central: centralOrigin(url) };
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

  if (site.kind === 'venture') {
    const venture = site.own ? ownDomainVenture(url.hostname) : await ventureBySlug(site.slug!);
    if (!venture) return new Response('Not found', { status: 404 });
    locals.site.venture = venture;
    // Sign-in steps and admin open on the central address, coming back here afterwards.
    if (matches(path, CENTRAL_PATHS)) {
      const params = new URLSearchParams(url.search);
      const back = params.get('next');
      if (back?.startsWith('/') && !back.startsWith('//')) params.set('next', `${url.origin}${back}`);
      if (path.startsWith('/admin')) { if (!params.has('company')) params.set('company', venture.code); }
      else params.set('venture', venture.slug!);
      return redirect(`${locals.site.central}${path}?${params}`, 302);
    }
    // A venture with its own domain is opened there (old links on its Lakeba address keep working).
    if (!site.own && venture.custom_domain_verified_at && venture.custom_domain) return redirect(`${siteOriginFor(url, venture)}${path}${url.search}`, 302);
  }
  // investors.lakeba.com/mist → mist.investors.lakeba.com
  if (site.kind === 'central' && context.request.method === 'GET') {
    const name = path.match(/^\/([a-z0-9-]+)\/?$/)?.[1];
    if (name && !RESERVED_SLUGS.includes(name) && await ventureBySlug(name)) return redirect(`${ventureOrigin(url, name)}/`, 302);
  }

  // getClaims() validates the JWT signature rather than trusting the cookie.
  const { data } = await locals.supabase.auth.getClaims();
  const claims = data?.claims;
  if (claims) {
    const codeVerified = claims.aal === 'aal2';
    // A passkey sign-in where the device checked the person counts as two-step (see passkey_sessions),
    // and so does a one-time pass from such a session to a venture's own domain (auth/redeem).
    const methods = ((claims.amr as { method: string }[] | undefined) ?? []).map((a) => a.method);
    const usedPasskey = !codeVerified && methods.includes('passkey');
    const maybeStrong = !codeVerified && methods.some((m) => ['passkey', 'otp', 'magiclink'].includes(m));
    const passkeyVerified = maybeStrong ? (await locals.supabase.rpc('session_is_strong')).data === true : false;
    locals.user = {
      id: claims.sub, email: String(claims.email ?? ''), aal: codeVerified || passkeyVerified ? 'aal2' : 'aal1',
      strongBy: codeVerified ? 'code' : passkeyVerified ? (usedPasskey ? 'passkey' : 'pass') : null, codeVerified,
    };
  }

  if (!locals.user) {
    if (matches(path, PUBLIC_PATHS)) return done(await next());
    if (site.kind === 'venture') return redirect(`${locals.site.central}/login?venture=${site.slug}&next=${encodeURIComponent(url.href)}`, 302);
    return redirect(`/login?next=${encodeURIComponent(path + url.search)}`);
  }

  // A session from before addresses were shared: write it again on the shared cookies (and drop this address's own).
  if (site.kind !== 'other' && !site.own && !context.cookies.get(SHARED_COOKIE)?.value) {
    const { data: { session } } = await locals.supabase.auth.getSession();
    if (session) await locals.supabase.auth.setSession({ access_token: session.access_token, refresh_token: session.refresh_token });
    context.cookies.set(SHARED_COOKIE, '1', { path: '/', domain: cookieDomain(url), httpOnly: true, sameSite: 'lax', secure: url.protocol === 'https:', maxAge: 31_536_000 });
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
  // On a venture's address, that venture is the company being viewed; people who don't belong to it go to the central address.
  if (locals.site.venture) {
    const mine = locals.companies.find((c) => c.id === locals.site.venture!.id);
    if (!mine) return redirect(`${locals.site.central}/?unavailable=${locals.site.venture.code}`, 302);
    locals.company = mine;
  }
  // Roles (System → Users); their permissions count only after two-step, like the database's can().
  locals.access = await loadAccess(serviceClient(), locals.user.id, locals.user.aal === 'aal2');
  const { data: flags } = await locals.supabase.rpc('my_portal_flags').maybeSingle();
  locals.features = {
    // The person's own switches, and the company's (Admin → Companies → Venture settings).
    ask: ((flags as { ask_enabled?: boolean } | null)?.ask_enabled ?? true) && (locals.company?.ask_enabled ?? true),
    boardQa: ((flags as { board_qa_enabled?: boolean } | null)?.board_qa_enabled ?? true) && (locals.company?.board_qa_enabled ?? true),
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

  if (matches(path, ['/login', '/forgot-password'])) return redirect(safeNext(url.searchParams.get('next')));

  return done(await next());
});

/** Removes this address's own copies of cookies that are now shared (see SHARED_COOKIE). */
function clearHostOnly(response: Response, names: Set<string>) {
  try {
    for (const name of names) response.headers.append('Set-Cookie', `${name}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`);
  } catch { /* a response with fixed headers: the next one clears them */ }
  return response;
}

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
