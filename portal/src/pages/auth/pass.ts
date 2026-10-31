import type { APIRoute } from 'astro';
import { createHash, randomBytes } from 'node:crypto';
import { serviceClient } from '../../lib/admin';
import { domainStatus } from '../../lib/domains';
import { crmDomainVenture, isOwnDomainAddress, ownDomainVenture } from '../../lib/sites';
import { loadAccess } from '../../lib/access';

/**
 * On the central address, for someone signed in: a one-time pass to a venture's
 * own domain (investors.mist.com), which can't share the session cookie. The
 * pass works once, on that address only, for two minutes; a two-step session
 * gives a two-step session there too (auth/redeem). Signed-out people are sent
 * to sign in first and come back here.
 *
 * Whoever controls a domain controls what reaches it, and a venture sets up its
 * own domain without Lakeba. So a pass only goes there for people who belong to
 * that venture alone (its shares, board or admins, and no other company) and
 * have no staff role, and only while the domain still points to the portal: a
 * venture misusing its domain could reach nothing it doesn't already hold.
 * Everyone else opens the venture on the central address instead.
 *
 * A venture's CRM address (crm.doxai.com) works the same way for its staff: a pass only for people whose
 * every role is for that venture alone (its salespeople, sales lead, admins) and who may open its CRM.
 * Anyone with a role for the group or another company opens the CRM on the central address, except on a
 * lakeba.com CRM address (Lakeba Group's own, in Lakeba's DNS), which Lakeba's staff may use too.
 */
export const GET: APIRoute = async ({ url, locals, redirect }) => {
  const to = url.searchParams.get('to') ?? '';
  if (!isOwnDomainAddress(to)) return redirect('/');
  const target = new URL(to);
  const crm = crmDomainVenture(target.hostname);
  if (crm) return crmPass(target, crm, locals, redirect);
  const venture = ownDomainVenture(target.hostname)!;
  const instead = () => redirect(`/company/${venture.code}?next=${encodeURIComponent(`${target.pathname}${target.search}`)}`, 303);
  const svc = serviceClient();
  const user = locals.user!;
  const [{ count: roles }, { data: mine }, dns] = await Promise.all([
    svc.from('user_roles').select('id', { count: 'exact', head: true }).eq('user_id', user.id),
    locals.supabase.rpc('my_entity_ids'),
    domainStatus(target.hostname),
  ]);
  const companies = new Set(((mine ?? []) as (string | { my_entity_ids: string })[]).map((e) => (typeof e === 'string' ? e : e.my_entity_ids)));
  const onlyThisVenture = companies.size === 1 && companies.has(venture.id);
  if (locals.profile?.role !== 'investor' || (roles ?? 0) > 0 || !onlyThisVenture || !dns.ok) return instead();
  const token = randomBytes(32).toString('base64url');
  await svc.from('sign_in_passes').insert({
    token_hash: createHash('sha256').update(token).digest('hex'), user_id: user.id, target_origin: target.origin,
    strong: user.aal === 'aal2', expires_at: new Date(Date.now() + 120_000).toISOString(),
  }).throwOnError();
  const next = `${target.pathname}${target.search}`;
  return redirect(`${target.origin}/auth/redeem?code=${encodeURIComponent(token)}&next=${encodeURIComponent(next)}`, 303);
};

async function crmPass(target: URL, crm: { id: string; code: string }, locals: App.Locals, redirect: (to: string, status?: 301 | 302 | 303 | 307 | 308) => Response) {
  const instead = () => redirect(`/admin/crm${target.pathname.startsWith('/admin/crm') ? target.pathname.slice('/admin/crm'.length) : ''}?company=${crm.code}`, 303);
  const svc = serviceClient();
  const user = locals.user!;
  const [{ data: roles }, access, dns] = await Promise.all([
    svc.from('user_roles').select('entity_id').eq('user_id', user.id),
    loadAccess(svc, user.id, user.aal === 'aal2'),
    domainStatus(target.hostname),
  ]);
  const onlyThisVenture = (roles ?? []).length > 0 && (roles ?? []).every((r) => r.entity_id === crm.id);
  // A lakeba.com CRM address (crm.lakeba.com) is in Lakeba's own DNS, so Lakeba's staff may use it too.
  const lakebaOwn = /(^|\.)lakeba\.com$/.test(target.hostname);
  if ((!onlyThisVenture && !lakebaOwn) || !access.can('crm.view', crm.id) || !dns.ok) return instead();
  const token = randomBytes(32).toString('base64url');
  await svc.from('sign_in_passes').insert({
    token_hash: createHash('sha256').update(token).digest('hex'), user_id: user.id, target_origin: target.origin,
    strong: user.aal === 'aal2', expires_at: new Date(Date.now() + 120_000).toISOString(),
  }).throwOnError();
  return redirect(`${target.origin}/auth/redeem?code=${encodeURIComponent(token)}&next=${encodeURIComponent(`${target.pathname}${target.search}`)}`, 303);
}
