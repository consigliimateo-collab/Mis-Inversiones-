/* Service worker: la app abre sin conexión y los precios siempre se piden frescos. */
const VERSION = 'inversiones-v3';
const SHELL = [
  './', 'index.html', 'manifest.webmanifest', 'css/styles.css',
  'js/main.js', 'js/views.js', 'js/data.js', 'js/store.js', 'js/prices.js', 'js/format.js',
  'js/chart.js', 'js/analytics.js', 'js/portfolio.js',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', e => {
  const { request } = e;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== location.origin) return;

  // Datos: red primero (siempre lo último); si no hay conexión, lo último guardado.
  if (/\/data\/[^/]+\.json$/.test(url.pathname)) {
    e.respondWith(
      fetch(request)
        .then(res => {
          const copy = res.clone();
          caches.open(VERSION).then(c => c.put(request, copy));
          return res;
        })
        .catch(() => caches.match(request, { ignoreSearch: true })),
    );
    return;
  }

  // Resto: caché primero y se refresca en segundo plano.
  e.respondWith(
    caches.open(VERSION).then(async cache => {
      const hit = await cache.match(request, { ignoreSearch: true });
      const network = fetch(request)
        .then(res => {
          if (res.ok) cache.put(request, res.clone());
          return res;
        })
        .catch(() => hit);
      return hit || network;
    }),
  );
});
