const CACHE = 'launch-shell-v12';
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((c) =>
        c.addAll([
          '/offline.html',
          '/offline.js',
          '/icons/icon-192.png',
          '/icons/icon-192.png?v=launch-rocket-1',
          '/icons/icon-512.png?v=launch-rocket-1',
          '/apple-touch-icon.png?v=launch-rocket-1',
          '/manifest.webmanifest',
        ]),
      ),
  );
  self.skipWaiting();
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
