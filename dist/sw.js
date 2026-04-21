// Topview Logger — Service Worker v3 (Network-First)
const CACHE_NAME = 'topview-v3';
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './icon-512.png',
  './manifest.json'
];

// Install: pre-cache core assets and immediately take over
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

// Activate: delete ALL old caches
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch: NETWORK FIRST — always try fresh files, fall back to cache only if offline
self.addEventListener('fetch', e => {
  e.respondWith(
    fetch(e.request).then(response => {
      // Got a fresh response — update cache and return it
      if (response && response.status === 200) {
        const clone = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(e.request, clone));
      }
      return response;
    }).catch(() => {
      // Network failed (offline) — serve from cache
      return caches.match(e.request).then(cached => {
        if (cached) return cached;
        if (e.request.mode === 'navigate') {
          return caches.match('./index.html');
        }
      });
    })
  );
});
