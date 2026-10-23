// Lakeba investor portal service worker: browser notifications only.
// It never caches pages or files (they hold personal data).

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = {}; }
  const title = data.title || 'Lakeba investor portal';
  event.waitUntil(show(title, data));
});

async function show(title, data) {
  const options = {
    body: data.body || 'Open the portal to read it.',
    icon: '/icons/icon-192.png',
    badge: '/icons/badge-72.png',
    tag: data.tag || undefined,
    // With a tag, a newer notification replaces the older one: still alert for it.
    renotify: Boolean(data.tag),
    data: { url: data.url || '/inbox' },
  };
  let error = null;
  try {
    await self.registration.showNotification(title, options);
  } catch (e) {
    error = String(e && (e.name || e.message) || e);
    // Some browsers reject an option they don't support: try once more with the basics.
    try { await self.registration.showNotification(title, { body: options.body, icon: options.icon, data: options.data }); error = `${error} (shown without extras)`; } catch (e2) { error = `${error}; ${String(e2 && (e2.name || e2.message) || e2)}`; }
  }
  let inTray = null;
  try { inTray = (await self.registration.getNotifications()).length; } catch { /* not supported */ }
  await noteReceived(title, error, inTray);
}
// Opens the page the notification is about, reusing a portal tab when one is open.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || '/inbox', self.location.origin);
  if (target.origin !== self.location.origin) return;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of windows) {
      if (new URL(client.url).origin === target.origin && 'navigate' in client) {
        await client.focus();
        return client.navigate(target.href);
      }
    }
    return self.clients.openWindow(target.href);
  })());
});
