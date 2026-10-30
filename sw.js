// Service worker: deixa o app instalável e abre mesmo sem internet (mostra últimos dados salvos).
const CACHE = 'nba-brasil-v3';
const ARQUIVOS = ['/', '/index.html', '/style.css', '/app.js', '/detalhes.js', '/manifest.json', '/icons/icon-192.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ARQUIVOS)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))));
  self.clients.claim();
});

// Rede primeiro (dados sempre frescos); se falhar, usa o cache.
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request)
      .then(r => {
        if (r.ok && new URL(e.request.url).origin === location.origin) {
          const copia = r.clone();
          caches.open(CACHE).then(c => c.put(e.request, copia));
        }
        return r;
      })
      .catch(() => caches.match(e.request))
  );
});
