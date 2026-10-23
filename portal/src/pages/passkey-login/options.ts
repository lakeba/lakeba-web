import type { APIRoute } from 'astro';
import { badRequest, json, passkeyError } from '../../lib/passkeys';

/** Step 1 of passkey sign-in: a fresh challenge for the browser to sign. */
export const POST: APIRoute = async ({ request, url, locals }) => {
  const bad = badRequest(request, url);
  if (bad) return bad;
  const { captchaToken } = (await request.json().catch(() => ({}))) as { captchaToken?: string };
  const { data, error } = await locals.supabase.auth.passkey.startAuthentication({ options: { captchaToken } });
  if (error || !data) return json({ error: passkeyError(error) }, 400);
  return json({ challenge_id: data.challenge_id, options: data.options });
};
