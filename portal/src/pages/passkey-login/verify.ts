import type { APIRoute } from 'astro';
import { safeNext } from '../../lib/supabase';
import { badRequest, json, passkeyError, userVerified } from '../../lib/passkeys';
import { serviceClient } from '../../lib/admin';
import { recordSignIn } from '../../lib/sign-in';

/** Step 2 of passkey sign-in: Supabase checks the signed challenge and the session goes into the cookies. */
export const POST: APIRoute = async ({ request, url, locals }) => {
  const bad = badRequest(request, url);
  if (bad) return bad;
  const { challenge_id, credential, next } = (await request.json().catch(() => ({}))) as { challenge_id?: string; credential?: unknown; next?: string };
  if (!challenge_id || !credential) return json({ error: locals.t('Missing passkey response.') }, 400);
  const { data, error } = await locals.supabase.auth.passkey.verifyAuthentication({ challengeId: challenge_id, credential: credential as never });
  if (error || !data?.session) return json({ error: locals.t(passkeyError(error)) }, 400);
  // The device checked the person (Face ID, Touch ID, Windows Hello, PIN): that counts as two-step,
  // so no authenticator code is asked. Without that check, people with two-step still enter their code.
  const verified = userVerified(credential);
  if (verified) {
    const sessionId = JSON.parse(Buffer.from(data.session.access_token.split('.')[1], 'base64url').toString()).session_id;
    const { error: e } = await serviceClient().from('passkey_sessions').insert({ session_id: sessionId, user_id: data.session.user.id });
    if (e) console.error('passkey_sessions insert failed', e.message);
  }
  await recordSignIn({ supabase: locals.supabase, userId: data.session.user.id, method: 'passkey', request, origin: url.origin, detail: { user_verified: verified } });
  return json({ redirect: safeNext(next) });
};
