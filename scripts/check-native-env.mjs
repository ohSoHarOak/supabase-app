/* Guard for `npm run build:native` (Workstream M).
 *
 * WHY THIS EXISTS
 * `web/src/config.js` resolves API_BASE as `import.meta.env.VITE_API_BASE ?? ''`.
 * An empty base is CORRECT for the web build (same-origin relative calls), and
 * CATASTROPHIC for the native build: the Capacitor WebView serves the app from
 * https://localhost, so a relative `/api/...` hits the on-device asset server
 * instead of the backend. That server answers with index.html and HTTP 200, so
 * the app doesn't even get a clean network error — it gets
 * "Request failed (200)" on the first login, and the APK looks fine until then.
 *
 * That exact bug shipped in the first two APKs (2026-08-17). Vite doesn't read
 * VITE_API_BASE from .env here, so forgetting the variable is a one-keystroke
 * mistake with a build that *appears* to succeed. Failing loudly is the fix.
 */
const base = process.env.VITE_API_BASE;

if (!base || !base.trim()) {
  console.error(`
[build:native] VITE_API_BASE is not set.

A native build with no API base produces an APK that silently fails on its
first request with "Request failed (200)" — the WebView's own asset server
answers the relative /api/... call with index.html.

Set it to the deployed origin and rebuild, e.g.

  PowerShell:  $env:VITE_API_BASE = "https://petpro-app.onrender.com"
               npm run build:native

  bash:        VITE_API_BASE="https://petpro-app.onrender.com" npm run build:native

See MOBILE.md. (The plain web build is unaffected: there, empty is correct.)
`);
  process.exit(1);
}

let url;
try {
  url = new URL(base);
} catch {
  console.error(`[build:native] VITE_API_BASE is not a valid URL: ${base}`);
  process.exit(1);
}

// A relative or localhost base defeats the whole point on a physical device.
if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') {
  console.error(
    `[build:native] VITE_API_BASE points at ${url.hostname}, which on a real device\n` +
      `resolves to the phone itself, not your backend. Use the deployed origin.`,
  );
  process.exit(1);
}

console.log(`[build:native] API base: ${url.origin}`);
