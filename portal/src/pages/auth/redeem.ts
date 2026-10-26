import type { APIRoute } from 'astro';
import { createHash } from 'node:crypto';
import { serviceClient } from '../../lib/admin';

/**
 * On a venture's own domain: turns a one-time pass (auth/pass) into a session
 * here. The pass is used up first, so it can't be replayed; it must be for this
 * address and not expired. If it came from a two-step session, this session
 * counts as two-step too (the same record a passkey sign-in uses).
 */
export const GET: APIRoute = async ({ url, locals, redirect }) => {
  const code = url.searchParams.get('code') ?? '';
  const next = url.searchParams.get('next') ?? '/';
  const back = next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/\\') ? next : '/';
  if (!/^[A-Za-z0-9_-]{30,64}$/.test(code)) return redirect('/login?error=link');
  const svc = serviceClient();
  const { data: pass } = await svc.from('sign_in_passes').update({ used_at: new Date().toISOString() })
    .eq('token_hash', createHash('sha256').update(code).digest('hex')).eq('target_origin', url.origin).is('used_at', null).gt('expires_at', new Date().toISOString())
    .select('user_id, strong').maybeSingle();
  if (!pass) return redirect('/login?error=link');
  const { data: user } = await svc.auth.admin.getUserById(pass.user_id);
  if (!user?.user?.email) return redirect('/login?error=link');
  // A sign-in link made on the server and used straight away (no email is sent).
  const { data: link, error: linkError } = await svc.auth.admin.generateLink({ type: 'magiclink', email: user.user.email });
  if (linkError || !link.properties?.hashed_token) return redirect('/login?error=link');
  const { data: signedIn, error } = await locals.supabase.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: 'magiclink' });
  if (error || !signedIn.session) return redirect('/login?error=link');
  if (pass.strong) {
    const sessionId = JSON.parse(Buffer.from(signedIn.session.access_token.split('.')[1], 'base64url').toString()).session_id as string;
    await svc.from('passkey_sessions').insert({ session_id: sessionId, user_id: pass.user_id }).throwOnError();
  }
  await locals.supabase.rpc('log_event', { event_action: 'sign_in', event_detail: { method: 'pass', strong: pass.strong } });
  return redirect(back, 303);
};
