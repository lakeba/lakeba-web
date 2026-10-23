import { createHash, randomBytes } from 'node:crypto';
import type { serviceClient } from './admin';

type Svc = ReturnType<typeof serviceClient>;

/**
 * A personal one-time link that signs this person in and opens `next`:
 * /e/<code>. Each link has its own code (only its hash is stored), so links
 * never cancel each other; the Supabase sign-in is created when it's used
 * (pages/e/[token].astro, after a "Continue" click that email scanners don't make).
 * Only ever sent to the person's own registered address.
 */
export async function createSignInLink(svc: Svc, { userId, origin, next, hours, emailId = null }: { userId: string; origin: string; next: string; hours: number; emailId?: string | null }) {
  const token = randomBytes(24).toString('base64url');
  await svc.from('email_sign_in_links').insert({
    token_hash: createHash('sha256').update(token).digest('hex'), user_id: userId, next_path: next, email_id: emailId,
    expires_at: new Date(Date.now() + hours * 3600_000).toISOString(),
  }).throwOnError();
  return `${origin}/e/${token}`;
}
