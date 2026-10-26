import type { APIRoute } from 'astro';
import { createHash, randomBytes } from 'node:crypto';
import { serviceClient } from '../../lib/admin';
import { isOwnDomainAddress } from '../../lib/sites';

/**
 * On the central address, for someone signed in: a one-time pass to a venture's
 * own domain (investors.mist.com), which can't share the session cookie. The
 * pass works once, on that address only, for two minutes; a two-step session
 * gives a two-step session there too (auth/redeem). Signed-out people are sent
 * to sign in first and come back here.
 */
export const GET: APIRoute = async ({ url, locals, redirect }) => {
  const to = url.searchParams.get('to') ?? '';
  if (!isOwnDomainAddress(to)) return redirect('/');
  const target = new URL(to);
  const token = randomBytes(32).toString('base64url');
  await serviceClient().from('sign_in_passes').insert({
    token_hash: createHash('sha256').update(token).digest('hex'), user_id: locals.user!.id, target_origin: target.origin,
    strong: locals.user!.aal === 'aal2', expires_at: new Date(Date.now() + 120_000).toISOString(),
  }).throwOnError();
  const next = `${target.pathname}${target.search}`;
  return redirect(`${target.origin}/auth/redeem?code=${encodeURIComponent(token)}&next=${encodeURIComponent(next)}`, 303);
};
