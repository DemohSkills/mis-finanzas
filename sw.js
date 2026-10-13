// Service Worker — Mis Finanzas
// Estrategia: cache-first para archivos de la app, red para el resto.
const CACHE = 'finanzas-v1';
const ARCHIVOS = ['./'];

self.addEventListener('install', e =>
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ARCHIVOS)).then(() => self.skipWaiting()))
);

self.addEventListener('activate', e =>
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  )
);

self.addEventListener('fetch', e => {
  // Solo interceptar peticiones de la misma app (no externas)
  if (!e.request.url.startsWith(self.location.origin)) return;
  e.respondWith(
    caches.match(e.request).then(cached => {
      // Devolver caché y actualizar en background
      const network = fetch(e.request).then(res => {
        if (res && res.status === 200 && res.type === 'basic') {
          const clon = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clon));
        }
        return res;
      }).catch(() => null);
      return cached || network;
    })
  );
});
