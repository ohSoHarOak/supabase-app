/* PWA service-worker registration (Workstream M / M0-d).

   Web only. In the Capacitor native shell, window.Capacitor is defined and we
   skip the SW entirely (the native container owns offline/caching). Registers
   only in a production build so the dev server (`npm run dev:web`) is never
   shadowed by a stale cache. */
export function registerPWA() {
  if (typeof window === 'undefined') return;
  if (window.Capacitor) return; // native shell — no service worker
  if (!import.meta.env.PROD) return; // dev: don't cache
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      /* SW is a progressive enhancement — the app works without it. */
    });
  });
}
