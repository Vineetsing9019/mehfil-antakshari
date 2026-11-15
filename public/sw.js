// Service worker: makes Mehfil installable and opens the app shell without internet.
// Live play (Socket.IO) always needs the network; everything else is network-first with a saved copy.
const CACHE = 'mehfil-v3';
const SHELL = ['/', '/app.css', '/app.js', '/socket.io/socket.io.js', '/manifest.json', '/icon-192.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).catch(() => {}).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  const url = new URL(req.url);
  // Live connections are never cached; the connection library file itself is, so the page opens offline.
  const live = url.pathname.startsWith('/socket.io/') && url.pathname !== '/socket.io/socket.io.js';
  if (req.method !== 'GET' || url.origin !== self.location.origin || live) return;
  e.respondWith(fetch(req)
    .then(res => {
      if (res.ok && res.type === 'basic') { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
      return res;
    })
    .catch(() => caches.match(req).then(hit => hit || (req.mode === 'navigate' ? caches.match('/') : undefined))));
});
