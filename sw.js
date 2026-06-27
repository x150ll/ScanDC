/* ماسح — Scan Bay | Service Worker
   Strategy:
   - App shell (HTML/manifest/icons): cached on install, served cache-first
     with a background refresh so the app opens instantly and works offline.
   - CDN libraries (OpenCV, jsPDF, Tesseract + lang data): cached on first use
     (cache-first, runtime). They are large, so the very first online visit is
     what makes full offline use possible afterwards.
   - Navigation requests: network-first, falling back to the cached shell so a
     fresh deploy is picked up when online but the app still loads offline.
*/

const VERSION = 'v1.1.0';
const SHELL_CACHE = 'scanbay-shell-' + VERSION;
const RUNTIME_CACHE = 'scanbay-runtime-' + VERSION;

// Core files that make up the installable app shell.
const SHELL_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './maskable-192.png',
  './maskable-512.png',
  './apple-touch-icon.png',
  './favicon-32.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) =>
      // Add individually and ignore failures so one missing optional icon
      // doesn't abort the whole install.
      Promise.allSettled(SHELL_ASSETS.map((url) => cache.add(url)))
    ).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k !== SHELL_CACHE && k !== RUNTIME_CACHE)
          .map((k) => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// Identify large third-party library requests we want to persist for offline.
function isCDNLibrary(url) {
  return (
    url.includes('cdnjs.cloudflare.com') ||
    url.includes('docs.opencv.org') ||
    url.includes('cdn.jsdelivr.net') ||
    url.includes('unpkg.com') ||
    url.includes('tessdata') ||
    url.includes('tesseract') ||
    url.includes('fonts.googleapis.com') ||
    url.includes('fonts.gstatic.com') ||
    url.endsWith('.wasm') ||
    url.endsWith('.traineddata.gz')
  );
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = req.url;

  // 1) Navigations -> network-first, fall back to cached shell (offline support)
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(SHELL_CACHE).then((c) => c.put('./index.html', copy));
          return res;
        })
        .catch(() => caches.match('./index.html').then((r) => r || caches.match('./')))
    );
    return;
  }

  // 2) CDN libraries -> cache-first, store on first successful fetch
  if (isCDNLibrary(url)) {
    event.respondWith(
      caches.match(req).then((cached) => {
        if (cached) return cached;
        return fetch(req).then((res) => {
          if (res && (res.status === 200 || res.type === 'opaque')) {
            const copy = res.clone();
            caches.open(RUNTIME_CACHE).then((c) => c.put(req, copy));
          }
          return res;
        });
      })
    );
    return;
  }

  // 3) Same-origin assets (icons, etc.) -> cache-first with runtime fill
  const sameOrigin = url.startsWith(self.location.origin);
  if (sameOrigin) {
    event.respondWith(
      caches.match(req).then((cached) => {
        if (cached) return cached;
        return fetch(req).then((res) => {
          if (res && res.status === 200) {
            const copy = res.clone();
            caches.open(RUNTIME_CACHE).then((c) => c.put(req, copy));
          }
          return res;
        }).catch(() => cached);
      })
    );
  }
});

// Allow the page to trigger an immediate update when a new SW is waiting.
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});
