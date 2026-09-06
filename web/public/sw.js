/* Sit.Stay.Play — PWA service worker (Workstream M / M0-d).

   Safe caching, deliberately conservative:
   - /api/*            NEVER cached. A stale schedule or invoice is worse than a
                       spinner — the API is always the live source of truth.
   - cross-origin      passed straight through (Stripe Checkout, Supabase
                       Realtime, etc. must never be intercepted).
   - /assets/*         content-hashed immutable bundles -> cache-first (the name
                       changes whenever the content does, so this is always safe).
   - navigations/HTML  network-first, so the app is fresh whenever online; falls
                       back to cache, then a small offline page.
   - other static      (styles.css, icon, manifest) stale-while-revalidate.

   Not a precache manifest — that's the vite-plugin-pwa upgrade for later. This
   baseline satisfies the roadmap's "never cache API" rule and gives an offline
   message instead of a browser error. */

const SHELL = 'sitstayplay-shell-v1';
const OFFLINE_HTML =
  '<!doctype html><meta charset="utf-8">' +
  '<meta name="viewport" content="width=device-width,initial-scale=1">' +
  '<title>Offline — Sit.Stay.Play</title>' +
  '<body style="font-family:system-ui,sans-serif;margin:0;display:grid;place-items:center;min-height:100vh;background:#F7F2EB;color:#333">' +
  '<div style="text-align:center;padding:2rem;max-width:22rem">' +
  '<h1 style="color:#2B7192;margin:0 0 .5rem">You\'re offline</h1>' +
  '<p>Sit.Stay.Play needs a connection to load. Reconnect and try again.</p></div>';

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== SHELL).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;                         // never touch mutations
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;          // Stripe / Supabase / CDNs
  if (url.pathname.startsWith('/api')) return;              // NEVER cache the API

  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(cacheFirst(req));
  } else if (req.mode === 'navigate') {
    event.respondWith(networkFirst(req));
  } else {
    event.respondWith(staleWhileRevalidate(req));
  }
});

async function cacheFirst(req) {
  const cache = await caches.open(SHELL);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) cache.put(req, res.clone());
  return res;
}

async function networkFirst(req) {
  const cache = await caches.open(SHELL);
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch {
    const hit = await cache.match(req);
    return hit || new Response(OFFLINE_HTML, { headers: { 'Content-Type': 'text/html' } });
  }
}

async function staleWhileRevalidate(req) {
  const cache = await caches.open(SHELL);
  const hit = await cache.match(req);
  const fetching = fetch(req)
    .then((res) => { if (res.ok) cache.put(req, res.clone()); return res; })
    .catch(() => null);
  return hit || (await fetching) || Response.error();
}
