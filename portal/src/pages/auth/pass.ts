import type { APIRoute } from 'astro';
import { createHash, randomBytes } from 'node:crypto';
import { serviceClient } from '../../lib/admin';
import { domainStatus } from '../../lib/domains';
import { isOwnDomainAddress, ownDomainVenture, ventureOrigin } from '../../lib/sites';

/**
 * On the central address, for someone signed in: a one-time pass to a venture's
 * own domain (investors.mist.com), which can't share the session cookie. The
 * pass works once, on that address only, for two minutes; a two-step session
 * gives a two-step session there too (auth/redeem). Signed-out people are sent
 * to sign in first and come back here.
 *
 * Whoever controls a domain controls what reaches it, so a pass only goes to
 * the venture's own domain for that venture's investors, never for staff
 * (admins, board, anyone with a role), and only while the domain still points
 * to the portal. Everyone else opens the venture on its Lakeba address instead.
 */
export const GET: APIRoute = async ({ url, locals, redirect }) => {
  const to = url.searchParams.get('to') ?? '';
  if (!isOwnDomainAddress(to)) return redirect('/');
  const target = new URL(to);
  const venture = ownDomainVenture(target.hostname)!;
  const instead = () => redirect(venture.slug ? `${ventureOrigin(url, venture.slug)}${target.pathname}${target.search}` : '/', 303);
  const svc = serviceClient();
  const user = locals.user!;
  const [{ count: roles }, { data: mine }, dns] = await Promise.all([
    svc.from('user_roles').select('id', { count: 'exact', head: true }).eq('user_id', user.id),
    locals.supabase.rpc('my_entity_ids'),
    domainStatus(target.hostname),
  ]);
  const member = ((mine ?? []) as (string | { my_entity_ids: string })[]).some((e) => (typeof e === 'string' ? e : e.my_entity_ids) === venture.id);
  if (locals.profile?.role !== 'investor' || (roles ?? 0) > 0 || !member || !dns.ok) return instead();
  const token = randomBytes(32).toString('base64url');
  await svc.from('sign_in_passes').insert({
    token_hash: createHash('sha256').update(token).digest('hex'), user_id: user.id, target_origin: target.origin,
    strong: user.aal === 'aal2', expires_at: new Date(Date.now() + 120_000).toISOString(),
  }).throwOnError();
  const next = `${target.pathname}${target.search}`;
  return redirect(`${target.origin}/auth/redeem?code=${encodeURIComponent(token)}&next=${encodeURIComponent(next)}`, 303);
};
