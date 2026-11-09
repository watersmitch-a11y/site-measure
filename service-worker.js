const CACHE_NAME = 'site-measure-v31';
const CORE_ASSETS = [
  './',
  './index.html',
  './css/styles.css',
  './js/app.js',
  './js/geometry.js',
  './js/units.js',
  './js/storage.js',
  './js/render.js',
  './js/length-input.js',
  './js/openings.js',
  './js/rooms.js',
  './js/export.js',
  './js/dxf.js',
  './js/jobfile.js',
  './js/photos.js',
  './manifest.json',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    // cache: 'reload' skips the browser's HTTP cache so we never store stale files
    caches.open(CACHE_NAME).then((cache) =>
      Promise.all(CORE_ASSETS.map((url) =>
        fetch(new Request(url, { cache: 'reload' })).then((res) => cache.put(url, res))
      ))
    )
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// The saved copy answers straight away, so the app opens instantly even with
// poor reception on site; the network copy is fetched in the background and
// saved for next time. New versions arrive as a new service worker (the
// version number above changes), which reloads the page once it takes over.
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET' || !event.request.url.startsWith(self.location.origin)) return;
  event.respondWith(
    caches.open(CACHE_NAME).then((cache) =>
      cache.match(event.request, { ignoreSearch: true }).then((cached) => {
        const fresh = fetch(event.request, { cache: 'no-cache' })
          .then((response) => {
            if (response.ok) cache.put(event.request, response.clone());
            return response;
          })
          .catch(() => cached);
        if (cached) {
          event.waitUntil(fresh.catch(() => {}));
          return cached;
        }
        return fresh;
      })
    )
  );
});
