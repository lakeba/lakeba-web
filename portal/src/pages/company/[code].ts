import type { APIRoute } from 'astro';
import { COMPANY_COOKIE } from '../../lib/companies';
import { siteOriginFor } from '../../lib/sites';

/**
 * Switches the company being viewed, then returns to a page in the portal. With
 * venture addresses on, a venture opens on its own address (mist.investors.lakeba.com)
 * and Lakeba on the central one.
 */
export const GET: APIRoute = ({ params, url, locals, cookies, redirect }) => {
  const company = locals.companies.find((c) => c.code === params.code?.toUpperCase());
  if (!company) return new Response('Not found', { status: 404 });
  const next = url.searchParams.get('next') ?? '/';
  const path = next.startsWith('/') && !next.startsWith('//') ? next : '/';
  const origin = siteOriginFor(url, company);
  if (origin !== url.origin) return redirect(`${origin}${path}`, 303);
  cookies.set(COMPANY_COOKIE, company.code, { path: '/', httpOnly: true, sameSite: 'lax', secure: url.protocol === 'https:', maxAge: 60 * 60 * 24 * 365 });
  return redirect(path, 303);
};
