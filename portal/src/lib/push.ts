import webpush from 'web-push';
import { Agent } from 'node:https';
import { PUSH_TEST_ENDPOINTS, VAPID_PRIVATE_KEY, VAPID_PUBLIC_KEY, VAPID_SUBJECT } from 'astro:env/server';
import { serviceClient } from './admin';
import { CATEGORIES, categoryOf } from './notification-events';

// Browser notifications (Web Push). Pushes go into notification_outbox and a
// small worker in the portal process sends them, so publishing never waits.

type Svc = ReturnType<typeof serviceClient>;
export type PushPayload = { title: string; body: string; url: string; tag?: string };

export const pushEnabled = () => Boolean(VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY);
export const vapidPublicKey = () => VAPID_PUBLIC_KEY ?? '';
if (pushEnabled()) webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY!, VAPID_PRIVATE_KEY!);

/** Only the browsers' own push services (so the server can't be pointed at other addresses). */
const PUSH_HOSTS = [/(^|\.)fcm\.googleapis\.com$/, /(^|\.)push\.apple\.com$/, /(^|\.)push\.services\.mozilla\.com$/, /(^|\.)notify\.windows\.com$/];
const isTestEndpoint = (endpoint: string) => Boolean(PUSH_TEST_ENDPOINTS && PUSH_TEST_ENDPOINTS.split(',').some((p) => p && endpoint.startsWith(p)));
// Staging tests use a local stand-in push service with a self-signed certificate.
const testAgent = new Agent({ rejectUnauthorized: false });
export function allowedEndpoint(endpoint: string) {
  if (isTestEndpoint(endpoint)) return true;
  try {
    const u = new URL(endpoint);
    return u.protocol === 'https:' && PUSH_HOSTS.some((h) => h.test(u.hostname));
  } catch { return false; }
}

/** Each person's email/push choice for a category (defaults when they haven't chosen). */
export async function preferences(svc: Svc, userIds: string[], categoryKey: string) {
  const category = CATEGORIES.find((c) => c.key === categoryKey);
  const result = new Map(userIds.map((id) => [id, { email: category?.email ?? true, push: category?.push ?? true }]));
  if (!category || category.locked || !userIds.length) return result;
  for (let i = 0; i < userIds.length; i += 500) {
    const { data } = await svc.from('notification_preferences').select('user_id, email, push').eq('category', categoryKey).in('user_id', userIds.slice(i, i + 500));
    for (const p of data ?? []) result.set(p.user_id, { email: p.email, push: p.push });
  }
  return result;
}

/** Queues a push to every device of these people who chose push for this kind. Returns how many were queued. */
export async function queuePush(svc: Svc, userIds: string[], kind: string, payload: PushPayload) {
  if (!pushEnabled() || !userIds.length) return 0;
  const category = categoryOf(kind);
  const prefs = category ? await preferences(svc, userIds, category.key) : null;
  const wanted = userIds.filter((id) => !prefs || prefs.get(id)?.push);
  if (!wanted.length) return 0;
  const rows: { subscription_id: string; user_id: string; kind: string; payload: PushPayload }[] = [];
  for (let i = 0; i < wanted.length; i += 500) {
    const { data } = await svc.from('push_subscriptions').select('id, user_id').in('user_id', wanted.slice(i, i + 500));
    for (const s of data ?? []) rows.push({ subscription_id: s.id, user_id: s.user_id, kind, payload });
  }
  for (let i = 0; i < rows.length; i += 500) await svc.from('notification_outbox').insert(rows.slice(i, i + 500)).throwOnError();
  if (rows.length) setTimeout(() => void processOutbox().catch(() => {}), 0);
  return rows.length;
}

const MAX_ATTEMPTS = 5;
let processing = false;

/** Sends what's due. Gone devices (404/410) are removed; other failures retry with backoff. */
export async function processOutbox() {
  if (!pushEnabled() || processing) return 0;
  processing = true;
  try {
    const svc = serviceClient();
    let sent = 0;
    for (;;) {
      const { data: due } = await svc.from('notification_outbox')
        .select('id, attempts, payload, subscription_id, push_subscriptions(id, endpoint, p256dh, auth, failures)')
        .is('sent_at', null).is('failed_at', null).lte('next_attempt_at', new Date().toISOString())
        .order('id').limit(50);
      if (!due?.length) break;
      await Promise.all(due.map(async (row) => {
        const sub = row.push_subscriptions as unknown as { id: string; endpoint: string; p256dh: string; auth: string; failures: number } | null;
        if (!sub) return;
        try {
          await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, JSON.stringify(row.payload), { TTL: 24 * 3600, urgency: 'normal', ...(isTestEndpoint(sub.endpoint) ? { agent: testAgent } : {}) });
          await svc.from('notification_outbox').update({ sent_at: new Date().toISOString(), attempts: row.attempts + 1, error: null }).eq('id', row.id);
          await svc.from('push_subscriptions').update({ last_success_at: new Date().toISOString(), failures: 0 }).eq('id', sub.id);
          sent++;
        } catch (e) {
          const status = (e as { statusCode?: number }).statusCode;
          if (status === 404 || status === 410) {
            await svc.from('push_subscriptions').delete().eq('id', sub.id); // the browser dropped this subscription
            return;
          }
          const attempts = row.attempts + 1;
          const message = `${status ?? ''} ${(e as Error).message ?? e}`.trim().slice(0, 500);
          await svc.from('notification_outbox').update(attempts >= MAX_ATTEMPTS
            ? { attempts, error: message, failed_at: new Date().toISOString() }
            : { attempts, error: message, next_attempt_at: new Date(Date.now() + 30_000 * 2 ** attempts).toISOString() }).eq('id', row.id);
          await svc.from('push_subscriptions').update({ failures: sub.failures + 1 }).eq('id', sub.id);
        }
      }));
    }
    return sent;
  } finally {
    processing = false;
  }
}
