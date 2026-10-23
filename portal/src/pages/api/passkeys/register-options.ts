import type { APIRoute } from 'astro';
import { badRequest, json, passkeyError, stepUpProblem } from '../../../lib/passkeys';

/** Step 1 of adding a passkey: confirm it's really them, then a challenge for the browser. */
export const POST: APIRoute = async ({ request, url, locals }) => {
  const bad = badRequest(request, url);
  if (bad) return bad;
  const { password } = (await request.json().catch(() => ({}))) as { password?: string };
  const problem = await stepUpProblem(locals.supabase, locals.user!.email, password ?? '');
  if (problem) return json({ error: problem, needsPassword: true }, 400);
  const { data, error } = await locals.supabase.auth.passkey.startRegistration();
  if (error || !data) return json({ error: passkeyError(error) }, 400);
  return json({ challenge_id: data.challenge_id, options: data.options });
};
