/** Service worker for IdleRPG app shell, static assets, and offline fallback. */

const CACHE_NAME = 'idlerpg-shell-v3';
const SHELL_URLS = [
  '/',
  '/index.php',
  '/how-to-play.php',
  '/commands.php',
  '/faq.php',
  '/offline.html',
  '/assets/app.css',
  '/assets/guide.css',
  '/assets/app.js',
  '/assets/pwa.js',
  '/favicon.svg',
  '/manifest.webmanifest',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_URLS)).catch(() => undefined),
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

function isStaticAsset(pathname) {
  return /\.(css|js|svg|png|webmanifest)$/i.test(pathname);
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;

  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, copy)).catch(() => undefined);
          return res;
        })
        .catch(async () => (await caches.match(req)) || (await caches.match('/offline.html')) || Response.error()),
    );
    return;
  }

  if (isStaticAsset(url.pathname)) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, copy)).catch(() => undefined);
          return res;
        })
        .catch(() => caches.match(req).then((cached) => cached || Response.error())),
    );
  }
});
