import type { APIRoute } from 'astro';
import type { EmailOtpType } from '@supabase/supabase-js';
import { safeNext } from '../../lib/supabase';
import { recordSignIn } from '../../lib/sign-in';

/** Landing point for emailed links: magic link, password reset, invitations. */
export const GET: APIRoute = async ({ url, locals, redirect, request }) => {
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
  const { data: claims } = await supabase.auth.getClaims();
  if (claims?.claims.sub) await recordSignIn({ supabase, userId: claims.claims.sub, method: 'email_link', request, origin: url.origin });
  return redirect(type === 'recovery' || type === 'invite' ? '/account/password' : next);
};
