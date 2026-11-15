// Service worker: Mehfil opens instantly on later visits and works without internet.
// App files (page, script, styles, icons) come from the saved copy at once and are refreshed in the background,
// so a new version shows on the next visit. Live play and data (Socket.IO, /config, /leaderboard, photos) always use the network.
const CACHE = 'mehfil-v5';
const SHELL = ['/', '/app.css', '/app.js', '/socket.io/socket.io.min.js', '/manifest.json', '/icon-192.png'];
const APP_FILE = /\.(js|css|png|svg|json|ico|woff2?)$/;

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
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  const live = url.pathname.startsWith('/socket.io/') && !url.pathname.startsWith('/socket.io/socket.io');
  const data = /^\/(config|leaderboard|qr|p)\b/.test(url.pathname);
  if (live) return;
  // the page itself: any link (/?t=CODE too) opens the saved page; the app reads the link itself
  const key = req.mode === 'navigate' ? '/' : req;
  const fresh = fetch(req).then(res => {
    if (res.ok && res.type === 'basic' && !data) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(key, copy)); }
    return res;
  });
  if (data) { e.respondWith(fresh.catch(() => caches.match(req))); return; }
  if (req.mode === 'navigate' || APP_FILE.test(url.pathname)) {
    e.respondWith(caches.match(key).then(hit => {
      if (hit) {
        // Refresh the saved copy in the background; if the page or the app script changed, tell the open pages.
        const key2 = url.pathname === '/' || req.mode === 'navigate' || url.pathname === '/app.js';
        e.waitUntil(fresh.then(res => {
          const was = hit.headers.get('etag'), now = res.headers.get('etag');
          if (key2 && res.ok && was && now && was !== now) {
            return self.clients.matchAll().then(list => list.forEach(c => c.postMessage('mehfil-updated')));
          }
        }).catch(() => {}));
        return hit;
      }
      return fresh.catch(() => caches.match('/'));
    }));
    return;
  }
  e.respondWith(fresh.catch(() => caches.match(req)));
});
