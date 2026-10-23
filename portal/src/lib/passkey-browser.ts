// Browser side of passkeys: only the WebAuthn step (Face ID, Touch ID, Windows
// Hello, a phone or a security key). The portal's server talks to Supabase.
import {
  browserSupportsWebAuthn,
  createCredential,
  deserializeCredentialCreationOptions,
  deserializeCredentialRequestOptions,
  getCredential,
  serializeCredentialCreationResponse,
  serializeCredentialRequestResponse,
} from '@supabase/auth-js/dist/module/lib/webauthn.js';

export const passkeysSupported = () => browserSupportsWebAuthn();

type Result = { error?: string; redirect?: string; needsPassword?: boolean; name?: string };

async function post(path: string, body: unknown): Promise<Result & Record<string, unknown>> {
  const res = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return res.json().catch(() => ({ error: 'Something went wrong. Please try again.' }));
}

// Cancelling the system prompt is not an error worth showing.
const cancelled = (e: unknown) => /NotAllowedError|AbortError|cancel/i.test(String((e as { name?: string })?.name ?? e) + String((e as { message?: string })?.message ?? ''));

export async function signInWithPasskey(next: string, captchaToken?: string): Promise<Result> {
  const start = await post('/passkey-login/options', { captchaToken });
  if (start.error) return start;
  const { data: credential, error } = await getCredential({ publicKey: deserializeCredentialRequestOptions(start.options as never) });
  if (error || !credential) return cancelled(error) ? {} : { error: 'Your device couldn’t use a passkey. Try again, or sign in with your password.' };
  return post('/passkey-login/verify', { challenge_id: start.challenge_id, credential: serializeCredentialRequestResponse(credential as never), next });
}

export async function addPasskey(password: string): Promise<Result> {
  const start = await post('/api/passkeys/register-options', { password });
  if (start.error) return start;
  const { data: credential, error } = await createCredential({ publicKey: deserializeCredentialCreationOptions(start.options as never) });
  if (error || !credential) return cancelled(error) ? {} : { error: 'Your device couldn’t create a passkey. Please try again.' };
  return post('/api/passkeys/register-verify', { challenge_id: start.challenge_id, credential: serializeCredentialCreationResponse(credential as never) });
}
