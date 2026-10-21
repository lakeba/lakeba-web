import type { APIRoute } from 'astro';
import type { EmailOtpType } from '@supabase/supabase-js';
import { safeNext } from '../../lib/supabase';

/** Landing point for emailed links: magic link, password reset, invitations. */
export const GET: APIRoute = async ({ url, locals, redirect }) => {
  const next = safeNext(url.searchParams.get('next'));
  const code = url.searchParams.get('code');
  const tokenHash = url.searchParams.get('token_hash');
  const type = url.searchParams.get('type') as EmailOtpType | null;
  const supabase = locals.supabase;

  const { error } = code
    ? await supabase.auth.exchangeCodeForSession(code)
    : tokenHash && type
      ? await supabase.auth.verifyOtp({ token_hash: tokenHash, type })
      : { error: new Error('missing token') };

  if (error) return redirect('/login?error=link');
  await supabase.rpc('log_event', { event_action: 'sign_in', event_detail: { method: 'email_link' } });
  return redirect(type === 'recovery' || type === 'invite' ? '/account/password' : next);
};
