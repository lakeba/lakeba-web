import type { APIRoute } from 'astro';
import { COMPANY_COOKIE } from '../../lib/companies';

/**
 * Switches the company being viewed, then returns to a page in the portal.
 * Everyone switches on the central address; on a venture's own domain, choosing
 * another company goes to the central address (the own domain is that venture's).
 */
export const GET: APIRoute = ({ params, url, locals, cookies, redirect }) => {
  const company = locals.companies.find((c) => c.code === params.code?.toUpperCase());
  if (!company) return redirect(`${locals.site?.central ?? ''}/?unavailable=${encodeURIComponent(params.code ?? '')}`, 303);
  const next = url.searchParams.get('next') ?? '/';
  const path = next.startsWith('/') && !next.startsWith('//') ? next : '/';
  const venture = locals.site?.venture;
  if (venture && venture.id !== company.id) return redirect(`${locals.site.central}/company/${company.code}?next=${encodeURIComponent(path)}`, 303);
  cookies.set(COMPANY_COOKIE, company.code, { path: '/', httpOnly: true, sameSite: 'lax', secure: url.protocol === 'https:', maxAge: 60 * 60 * 24 * 365 });
  return redirect(path, 303);
};
