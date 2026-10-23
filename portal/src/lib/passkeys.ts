import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from 'astro:env/server';

// Passkeys (Supabase Auth, beta). The browser does the Face ID / Touch ID /
// security-key step; the portal's server asks Supabase for each challenge and
// checks the answer, so Supabase never has to be reachable from browsers.

export type Passkey = { id: string; friendly_name?: string; created_at: string; last_used_at?: string };

/** Adding a passkey within this long of signing in needs no password. */
const RECENT_SIGN_IN_MS = 5 * 60 * 1000;

export const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** Same-origin JSON requests only, so other sites can't drive these endpoints. */
export function badRequest(request: Request, url: URL) {
  if (request.headers.get('origin') !== url.origin) return json({ error: 'Forbidden' }, 403);
  if (!request.headers.get('content-type')?.startsWith('application/json')) return json({ error: 'Expected JSON' }, 415);
  return null;
}

/**
 * Before adding a passkey the person proves it's them: a two-step verified
 * session (Supabase also requires this when two-step is on), a sign-in in the
 * last few minutes, or their password now. The password is checked on a
 * throwaway client and that extra session is ended straight away.
 */
export async function stepUpProblem(supabase: SupabaseClient, email: string, password: string) {
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims as { aal?: string; amr?: { method: string; timestamp: number }[] } | undefined;
  if (claims?.aal === 'aal2') return null;
  const lastSignIn = Math.max(0, ...(claims?.amr ?? []).map((a) => a.timestamp * 1000));
  if (Date.now() - lastSignIn < RECENT_SIGN_IN_MS) return null;
  if (!password) return 'Enter your password to add a passkey.';
  const check = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error } = await check.auth.signInWithPassword({ email, password });
  if (error) return error.status === 429 ? 'Too many attempts. Please wait a minute and try again.' : 'That password is incorrect.';
  await check.auth.signOut({ scope: 'local' });
  return null;
}

/**
 * Whether the authenticator reports it verified the person (biometric or PIN):
 * the UV bit in the signed authenticator data. Called only after Supabase has
 * verified the signature over that same data, so it can't be forged.
 */
export function userVerified(credential: unknown) {
  const data = (credential as { response?: { authenticatorData?: string } })?.response?.authenticatorData;
  if (typeof data !== 'string') return false;
  const bytes = Buffer.from(data, 'base64url');
  return bytes.length > 32 && (bytes[32] & 0x04) !== 0;
}

/** A readable default name, e.g. "Chrome on Mac", from the browser's user agent. */
export function deviceName(userAgent: string) {
  const ua = userAgent || '';
  const browser = /Edg(A|iOS)?\//.test(ua) ? 'Edge' : /SamsungBrowser\//.test(ua) ? 'Samsung Internet' : /OPR\//.test(ua) ? 'Opera' : /Firefox\/|FxiOS\//.test(ua) ? 'Firefox' : /Chrome\/|CriOS\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  const device = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Mac OS X|Macintosh/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : 'device';
  return `${browser} on ${device}`;
}

/** Friendly messages for Supabase passkey errors. */
export function passkeyError(error: { code?: string; status?: number; message?: string } | null | undefined) {
  switch (error?.code) {
    case 'too_many_passkeys': return 'You already have the maximum number of passkeys. Remove one first.';
    case 'webauthn_credential_exists': return 'This passkey is already saved to your account.';
    case 'webauthn_challenge_expired': case 'webauthn_challenge_not_found': return 'That took too long. Please try again.';
    case 'webauthn_verification_failed': case 'webauthn_credential_not_found': return 'That passkey wasn’t recognised. Try another one, or sign in with your password.';
    case 'insufficient_aal': return 'Finish two-step verification first, then try again.';
    case 'user_banned': return 'This account has been disabled.';
    case 'email_not_confirmed': return 'Please confirm your email address first.';
    case 'passkey_disabled': return 'Passkeys aren’t available right now.';
  }
  return error?.status === 429 ? 'Too many attempts. Please wait a minute and try again.' : 'Something went wrong with the passkey. Please try again.';
}
