import type { APIRoute } from 'astro';
import { checkDomain, loadSetupCompany, setupStamp } from '../../../../lib/setup';

// The Domain and mail page's check every minute: a waiting own domain is
// checked (and put in use once its record shows); the page reloads when the
// stamp changed (something finished, here or through the IT person's link).
export const POST: APIRoute = async ({ params, locals, url }) => {
  const c = await loadSetupCompany({ code: params.code });
  if (!c || c.relationship === 'group' || !locals.access.can('investors.view', c.id)) return new Response('Not found', { status: 404 });
  const me = locals.user!;
  const r = c.custom_domain && !c.custom_domain_verified_at
    ? await checkDomain(c, { userId: me.id, email: me.email, label: me.email, manage: false, group: false }, locals.site?.central ?? url.origin)
    : null;
  const now = (await loadSetupCompany({ id: c.id }))!;
  return Response.json({ stamp: setupStamp(now), domain: r ? (r.ok ? 'The record is there.' : r.problem) : null }, { headers: { 'cache-control': 'no-store' } });
};
