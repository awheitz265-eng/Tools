// Hält die App-Dateien für den Offline-Start bereit. Wetterdaten werden nie gecacht.
const CACHE = 'wetter-v3';
const SHELL = ['./', 'index.html', 'style.css', 'manifest.webmanifest', 'js/app.js', 'js/sources.js', 'js/ensemble.js', 'js/scene.js', 'js/verify.js', 'icons/icon.svg', 'icons/icon-192.png'];

self.addEventListener('install', (ev) => {
  ev.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (ev) => {
  ev.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Eigene Dateien: zuerst Netz (damit Updates ankommen), sonst Cache.
self.addEventListener('fetch', (ev) => {
  const url = new URL(ev.request.url);
  if (ev.request.method !== 'GET' || url.origin !== self.location.origin) return;
  ev.respondWith(
    fetch(ev.request)
      .then((res) => {
        if (res.ok) caches.open(CACHE).then((c) => c.put(ev.request, res.clone()));
        return res;
      })
      .catch(() => caches.match(ev.request, { ignoreSearch: true })),
  );
});
