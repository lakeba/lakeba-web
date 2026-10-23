import type { APIRoute } from 'astro';
import { badRequest, json } from '../../../lib/passkeys';

/** Forgets this device's push subscription (only the signed-in person's own). */
export const POST: APIRoute = async ({ request, url, locals }) => {
  const bad = badRequest(request, url);
  if (bad) return bad;
  const { endpoint } = (await request.json().catch(() => ({}))) as { endpoint?: string };
  if (!endpoint) return json({ error: 'Missing endpoint.' }, 400);
  await locals.supabase.from('push_subscriptions').delete().eq('endpoint', endpoint).eq('user_id', locals.user!.id);
  await locals.supabase.rpc('log_event', { event_action: 'push_disabled' });
  return json({ ok: true });
};
