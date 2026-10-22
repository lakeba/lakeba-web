import type { APIRoute } from 'astro';
import { COMPANY_COOKIE } from '../../lib/companies';

/** Switches the company being viewed, then returns to a page in the portal. */
export const GET: APIRoute = ({ params, url, locals, cookies, redirect }) => {
  const company = locals.companies.find((c) => c.code === params.code?.toUpperCase());
  if (!company) return new Response('Not found', { status: 404 });
  cookies.set(COMPANY_COOKIE, company.code, { path: '/', httpOnly: true, sameSite: 'lax', secure: url.protocol === 'https:', maxAge: 60 * 60 * 24 * 365 });
  const next = url.searchParams.get('next') ?? '/';
  return redirect(next.startsWith('/') && !next.startsWith('//') ? next : '/', 303);
};
