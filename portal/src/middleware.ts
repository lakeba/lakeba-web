import { defineMiddleware } from 'astro:middleware';
import { createSupabase, safeNext } from './lib/supabase';
import { loadCompanyContext } from './lib/companies';
import { NO_ACCESS, adminMayRequest, formAction, loadAccess } from './lib/access';
import { rememberOrigin, startNotificationWorker } from './lib/notify-jobs';
import { serviceClient } from './lib/admin';
import { tradingEnabled } from './lib/trading';
import { INTL, fromAcceptLanguage, isLocale, translator, type Locale } from './lib/i18n';
import { formats } from './lib/format';
import { SUPABASE_URL, TWO_STEP_OFF_FOR_TESTING } from 'astro:env/server';
import { centralOrigin, ownDomainVenture, refreshOwnDomains, siteOf } from './lib/sites';
import { isKnownHost } from './lib/known-hosts.mjs';
import { NO_VIEW, VIEW_COOKIE, investorCompanyIds, wantsInvestorView } from './lib/investor-view';
import { TABLET_COOKIE, TABLET_PATH, connected, tabletOf } from './lib/tablets';

// Sends queued browser notifications and runs scheduled ones (reminders, daily summaries).
startNotificationWorker();

/** Pages reachable without signing in. */
const PUBLIC_PATHS = ['/tablet', '/api/tablet', '/press', '/login', '/forgot-password', '/auth/confirm', '/auth/redeem', '/auth/ms-consent', '/setup', '/go', '/passkey-login', '/e', '/room', '/news-media', '/company-logo', '/api/public', '/api/v1', '/api/hooks', '/developers', '/oauth/token', '/embed', '/n', '/favicon.ico'];
/** Pages a signed-in user can reach before finishing MFA. */
const MFA_PATHS = ['/mfa/verify', '/mfa/setup', '/logout', '/go', '/passkey-login'];

/** On a venture's own domain, these open on the central address (sign-in, two-step, passkeys and admin live there). */
const CENTRAL_PATHS = ['/login', '/forgot-password', '/passkey-login', '/mfa', '/account/security', '/api/passkeys', '/admin', '/auth/pass', '/oauth'];

/** Staging on this Mac only: staff can try the portal without an authenticator app. Never on another database. */
const twoStepOff = TWO_STEP_OFF_FOR_TESTING && /^http:\/\/(127\.0\.0\.1|localhost):54321$/.test(SUPABASE_URL);

const matches = (path: string, list: string[]) => list.some((p) => path === p || path.startsWith(`${p}/`));

export const onRequest = defineMiddleware(async (context, next) => {
  const { url, locals, redirect } = context;
  const path = url.pathname;
  // Ventures' own domains are let through by Astro with any other HTTPS name: turn away all but those.
  await refreshOwnDomains();
  if (!isKnownHost(url.hostname) && !ownDomainVenture(url.hostname)) return new Response('Not found', { status: 404 });
  rememberOrigin(url.origin);
  const site = siteOf(url);
  // The Observer page (a meeting's recording on the boardroom tablet) is the only one that may use the microphone.
  const done = (response: Response) => withSecurityHeaders(response, /^\/admin\/legal\/meetings\/[0-9a-f-]{36}\/observe$/.test(context.url.pathname));
  locals.supabase = createSupabase(context);
  locals.site = { kind: site.kind, venture: null, central: centralOrigin(url) };
  locals.user = null;
  locals.tablet = null;
  locals.profile = null;
  locals.mfaEnrolled = false;
  locals.companies = [];
  locals.company = null;
  locals.group = null;
  locals.adminOf = [];
  locals.access = NO_ACCESS;
  locals.investorView = NO_VIEW;
  locals.writing = !['GET', 'HEAD'].includes(context.request.method);
  locals.features = { ask: false, boardQa: false, trading: false };
  // Language: ?lang= (remembered in a cookie), else the cookie, else the browser; the profile choice wins once signed in.
  const asked = url.searchParams.get('lang');
  if (isLocale(asked)) context.cookies.set('lang', asked, { path: '/', maxAge: 31_536_000, sameSite: 'lax', secure: url.protocol === 'https:', httpOnly: true });
  const setLocale = (l: Locale) => { locals.locale = l; locals.t = translator(l); locals.fmt = formats(INTL[l]); };
  const cookieLang = context.cookies.get('lang')?.value;
  setLocale(isLocale(asked) ? asked : isLocale(cookieLang) ? cookieLang : fromAcceptLanguage(context.request.headers.get('accept-language')) ?? 'en');

  if (site.kind === 'venture') {
    const venture = ownDomainVenture(url.hostname);
    if (!venture) return new Response('Not found', { status: 404 });
    locals.site.venture = venture;
    // Sign-in steps and admin open on the central address, coming back here afterwards.
    if (matches(path, CENTRAL_PATHS)) {
      const params = new URLSearchParams(url.search);
      const back = params.get('next');
      if (back?.startsWith('/') && !back.startsWith('//')) params.set('next', `${url.origin}${back}`);
      if (path.startsWith('/admin')) { if (!params.has('company')) params.set('company', venture.code); }
      else if (venture.slug) params.set('venture', venture.slug);
      return redirect(`${locals.site.central}${path}?${params}`, 302);
    }
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
    let passkeyVerified = maybeStrong ? (await locals.supabase.rpc('session_is_strong')).data === true : false;
    // With two-step off for testing, the session is recorded as strong, so the database's checks agree too.
    if (twoStepOff && !codeVerified && !passkeyVerified && claims.session_id) {
      await serviceClient().from('passkey_sessions').upsert({ session_id: claims.session_id, user_id: claims.sub }, { ignoreDuplicates: true });
      passkeyVerified = true;
    }
    locals.user = {
      id: claims.sub, email: String(claims.email ?? ''), aal: codeVerified || passkeyVerified ? 'aal2' : 'aal1',
      strongBy: codeVerified ? 'code' : passkeyVerified ? (usedPasskey ? 'passkey' : 'pass') : null, codeVerified,
    };
  }

  // A boardroom tablet connected to a meeting (lib/tablets.ts) reaches that meeting's Observer and nothing else,
  // acting for the company secretary who connected it while signed in with two-step.
  const tabletPath = TABLET_PATH.exec(path);
  const tabletSecret = context.cookies.get(TABLET_COOKIE)?.value;
  if (!locals.user && tabletPath && tabletSecret && site.kind !== 'venture') {
    const svc = serviceClient();
    const t = await tabletOf(svc, tabletSecret);
    if (!connected(t) || t.meeting_id !== tabletPath[1]) {
      return locals.writing ? new Response('This tablet isn’t connected to this meeting.', { status: 403 }) : redirect('/tablet');
    }
    const { data: person } = await svc.from('profiles').select('email, first_name, last_name, role, locale').eq('id', t.paired_by).maybeSingle();
    if (!person) return locals.writing ? new Response('Forbidden', { status: 403 }) : redirect('/tablet');
    locals.user = { id: t.paired_by, email: person.email ?? '', aal: 'aal2', strongBy: 'tablet', codeVerified: false };
    locals.tablet = { id: t.id, meetingId: t.meeting_id };
    locals.profile = person as App.Locals['profile'];
    locals.access = await loadAccess(svc, t.paired_by, true);
    if (Date.now() - Date.parse(t.last_seen_at ?? '1970-01-01') > 60_000) await svc.from('board_tablets').update({ last_seen_at: new Date().toISOString() }).eq('id', t.id);
    return done(await next());
  }

  if (!locals.user) {
    // A session's investor view ends with it.
    if (wantsInvestorView(context.cookies)) context.cookies.delete(VIEW_COOKIE, { path: '/' });
    if (matches(path, PUBLIC_PATHS)) return done(await next());
    if (site.kind === 'venture') return redirect(`${locals.site.central}/login?${new URLSearchParams({ ...(site.slug ? { venture: site.slug } : {}), next: url.href })}`, 302);
    return redirect(`/login?next=${encodeURIComponent(path + url.search)}`);
  }

  // From the auth server, not the cookie: the cookie's copy of the person's factors isn't signed, so
  // someone could remove them there to skip two-step.
  const { data: factors } = await serviceClient().auth.admin.mfa.listFactors({ userId: locals.user.id });
  locals.mfaEnrolled = (factors?.factors ?? []).some((f) => f.status === 'verified');

  // Enrolled users must complete MFA for this session before anything else.
  if (locals.mfaEnrolled && locals.user.aal !== 'aal2' && !twoStepOff && !matches(path, MFA_PATHS)) {
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
  const staff = locals.access.staff;
  // View as investor (investor-view.ts): an admin who holds shares, without their admin powers for now.
  if (staff || locals.adminOf.length > 0 || profile?.role === 'admin') {
    const own = await investorCompanyIds(serviceClient(), locals.user.id);
    const on = own.holdings.size > 0 && wantsInvestorView(context.cookies);
    locals.investorView = { offered: true, available: own.holdings.size > 0, on };
    if (on) {
      locals.access = NO_ACCESS;
      locals.adminOf = [];
      if (locals.profile) locals.profile = { ...locals.profile, role: 'investor' };
      locals.companies = locals.companies.filter((c) => own.all.has(c.id));
      locals.group = locals.companies.find((c) => c.relationship === 'group') ?? null;
      locals.company = locals.companies.find((c) => c.id === locals.company?.id) ?? locals.group ?? locals.companies[0] ?? null;
      if (matches(path, ['/admin', '/api/admin'])) return locals.writing ? new Response('Forbidden', { status: 403 }) : redirect('/');
    }
  }
  // On a venture's own domain, that venture is the company being viewed; people who don't belong to it go to the central address.
  if (locals.site.venture) {
    const mine = locals.companies.find((c) => c.id === locals.site.venture!.id);
    if (!mine) return redirect(`${locals.site.central}/?unavailable=${locals.site.venture.code}`, 302);
    locals.company = mine;
  }
  const { data: flags } = await locals.supabase.rpc('my_portal_flags').maybeSingle();
  locals.features = {
    // The person's own switches, and the company's (Admin → Companies → Venture settings).
    ask: ((flags as { ask_enabled?: boolean } | null)?.ask_enabled ?? true) && (locals.company?.ask_enabled ?? true),
    boardQa: ((flags as { board_qa_enabled?: boolean } | null)?.board_qa_enabled ?? true) && (locals.company?.board_qa_enabled ?? true),
    trading: locals.company ? await tradingEnabled(serviceClient(), locals.company.id) : false,
  };

  // Anyone with a staff role cannot use the portal until they have enrolled MFA.
  if (staff && !locals.mfaEnrolled && !twoStepOff && !matches(path, MFA_PATHS)) {
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

function withSecurityHeaders(response: Response, microphone = false) {
  const h = response.headers;
  // Never shown inside other sites' frames; a route may allow the portal's own (newsletter previews).
  if (h.get('X-Frame-Options') !== 'SAMEORIGIN') h.set('X-Frame-Options', 'DENY');
  h.set('X-Content-Type-Options', 'nosniff');
  h.set('Referrer-Policy', 'same-origin');
  h.set('Permissions-Policy', `camera=(), microphone=${microphone ? '(self)' : '()'}, geolocation=()`);
  // Portal pages carry personal data: never cache them. Routes may opt into
  // private (browser-only) caching, e.g. company logos.
  if (!h.get('Cache-Control')?.startsWith('private')) h.set('Cache-Control', 'no-store');
  return response;
}
