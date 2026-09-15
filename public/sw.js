const CACHE = 'launch-shell-v17';
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((c) =>
        c.addAll([
          '/offline.html',
          '/offline.js?v=capture-1',
          '/icons/orbit-96.png?v=launch-orbit-1',
          '/icons/favicon-32.png?v=launch-orbit-1',
          '/icons/icon-192.png',
          '/icons/icon-192.png?v=launch-orbit-1',
          '/icons/icon-512.png?v=launch-orbit-1',
          '/apple-touch-icon.png?v=launch-orbit-1',
          '/manifest.webmanifest',
        ]),
      ),
  );
  self.skipWaiting();
});
function notificationUrl(value) {
  try {
    const url = new URL(
      typeof value === 'string' ? value : '/',
      self.location.origin,
    );
    if (url.origin === self.location.origin) return url.href;
  } catch {
    /* Fall back to Launch if a notification contains an invalid URL. */
  }
  return self.location.origin + '/';
}
self.addEventListener('push', (event) => {
  let message = {};
  try {
    message = event.data?.json() || {};
  } catch {
    /* Still show a visible reminder. */
  }
  const url = new URL(notificationUrl(message.url));
  event.waitUntil(
    self.registration.showNotification(
      typeof message.title === 'string' ? message.title : 'Launch reminder',
      {
        body:
          typeof message.body === 'string'
            ? message.body
            : 'Open Launch to view your reminder.',
        icon: '/icons/icon-192.png',
        tag: typeof message.tag === 'string' ? message.tag : 'launch-reminder',
        silent: false,
        vibrate: [200, 100, 200],
        data: {
          url: url.pathname + url.search,
        },
      },
    ),
  );
});
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const safeUrl = notificationUrl(event.notification.data?.url);
  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then(async (windows) => {
        const client = windows.find(
          (window) => new URL(window.url).origin === self.location.origin,
        );
        if (client) {
          await client.navigate(safeUrl);
          return client.focus();
        }
        return self.clients.openWindow(safeUrl);
      }),
  );
});
self.addEventListener('activate', (event) =>
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k.startsWith('launch-shell-') && k !== CACHE)
            .map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  ),
);
self.addEventListener('fetch', (event) => {
  const u = new URL(event.request.url);
  if (
    u.origin !== location.origin ||
    event.request.method !== 'GET' ||
    u.pathname.startsWith('/api/') ||
    u.pathname.includes('signin') ||
    u.pathname.includes('signout') ||
    u.pathname.includes('callback')
  )
    return;
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request, { cache: 'no-store' }).catch(() =>
        caches.match('/offline.html'),
      ),
    );
    return;
  }
  // Keep install metadata current instead of retaining an old home-screen icon.
  if (u.pathname === '/manifest.webmanifest') {
    event.respondWith(
      fetch(event.request)
        .then(async (response) => {
          if (response.ok) {
            const cache = await caches.open(CACHE);
            await cache.put(event.request, response.clone());
          }
          return response;
        })
        .catch(() => caches.match(event.request)),
    );
    return;
  }
  if (
    [
      '/offline.js',
      '/icons/orbit-96.png',
      '/icons/favicon-32.png',
      '/icons/icon-192.png',
      '/icons/icon-512.png',
      '/apple-touch-icon.png',
    ].includes(u.pathname)
  )
    event.respondWith(
      caches
        .match(event.request)
        .then((cached) => cached || fetch(event.request)),
    );
});
