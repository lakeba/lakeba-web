import type { APIRoute } from 'astro';
import { badRequest, deviceName, json, passkeyError } from '../../../lib/passkeys';
import { notifySecurity } from '../../../lib/notify';

/** Step 2 of adding a passkey: Supabase checks and saves it; we name it and tell the person by email. */
export const POST: APIRoute = async ({ request, url, locals }) => {
  const bad = badRequest(request, url);
  if (bad) return bad;
  const { challenge_id, credential } = (await request.json().catch(() => ({}))) as { challenge_id?: string; credential?: unknown };
  if (!challenge_id || !credential) return json({ error: 'Missing passkey response.' }, 400);
  const supabase = locals.supabase;
  const { data, error } = await supabase.auth.passkey.verifyRegistration({ challengeId: challenge_id, credential: credential as never });
  if (error || !data) return json({ error: passkeyError(error) }, 400);
  const name = deviceName(request.headers.get('user-agent') ?? '');
  await supabase.auth.passkey.update({ passkeyId: data.id, friendlyName: name });
  await supabase.rpc('log_event', { event_action: 'passkey_added', event_detail: { passkey_id: data.id, name } });
  // A heads-up in case it wasn't them (Inbox, email and browser notification).
  await notifySecurity({
    userId: locals.user!.id, origin: url.origin, pushDetail: `Passkey added: ${name}`,
    title: 'A passkey was added to your Lakeba investor account',
    body: `A passkey (“${name}”) was just added to your Lakeba investor portal account. You can now sign in with it instead of your password.\n\nIf this wasn’t you, remove it under Profile → Security and contact info@lakeba.com.`,
  });
  return json({ ok: true, name });
};
