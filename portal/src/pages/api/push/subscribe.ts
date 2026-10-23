import type { APIRoute } from 'astro';
import { serviceClient } from '../../../lib/admin';
import { badRequest, deviceName, json } from '../../../lib/passkeys';
import { allowedEndpoint, pushEnabled } from '../../../lib/push';

/** Saves this device's push subscription for the signed-in person (or refreshes it). */
export const POST: APIRoute = async ({ request, url, locals }) => {
  const bad = badRequest(request, url);
  if (bad) return bad;
  if (!pushEnabled()) return json({ error: 'Browser notifications aren’t available right now.' }, 503);
  const body = (await request.json().catch(() => ({}))) as { subscription?: { endpoint?: string; keys?: { p256dh?: string; auth?: string } } };
  const sub = body.subscription;
  if (!sub?.endpoint || !sub.keys?.p256dh || !sub.keys?.auth || sub.endpoint.length > 2000) return json({ error: 'Invalid subscription.' }, 400);
  if (!allowedEndpoint(sub.endpoint)) return json({ error: 'Unsupported push service.' }, 400);
  const userId = locals.user!.id;
  const { error } = await serviceClient().from('push_subscriptions').upsert({
    endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth, user_id: userId,
    device: deviceName(request.headers.get('user-agent') ?? ''), failures: 0,
  }, { onConflict: 'endpoint' });
  if (error) return json({ error: 'Could not save this device.' }, 500);
  await locals.supabase.rpc('log_event', { event_action: 'push_enabled', event_detail: { device: deviceName(request.headers.get('user-agent') ?? '') } });
  return json({ ok: true });
};
