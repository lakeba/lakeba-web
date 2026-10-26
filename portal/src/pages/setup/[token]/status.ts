import type { APIRoute } from 'astro';
import { checkDomain, handoffByToken, loadSetupCompany, setupStamp } from '../../../lib/setup';

// The IT person's page's check every minute (see admin/companies/[code]/domain-status.ts).
export const POST: APIRoute = async ({ params, locals, url }) => {
  const h = await handoffByToken(params.token ?? '');
  const c = h && (await loadSetupCompany({ id: h.entity_id }));
  if (!h || !c) return new Response('Not found', { status: 404 });
  const r = c.custom_domain && !c.custom_domain_verified_at
    ? await checkDomain(c, { userId: null, email: h.recipient_email, label: `${h.recipient_name ? `${h.recipient_name} (${h.recipient_email})` : h.recipient_email} through the set-up link`, handoffId: h.id, manage: false, group: false }, locals.site?.central ?? url.origin)
    : null;
  const now = (await loadSetupCompany({ id: c.id }))!;
  return Response.json({ stamp: setupStamp(now), domain: r ? (r.ok ? 'The record is there.' : r.problem) : null }, { headers: { 'cache-control': 'no-store' } });
};
