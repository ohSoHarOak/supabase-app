import { defineConfig } from 'vite';

/**
 * M0-a (Workstream M) — front-end build pipeline.
 *
 * PARITY FIRST: the three frontends (app.js / portal.js / pay.js + shared.js)
 * are still plain classic scripts served from `web/public/` (Vite's publicDir),
 * byte-for-byte what they were under `public/`. Vite only templates the HTML and
 * gives us a dev server + a real build output for Capacitor to wrap. Turning the
 * scripts into an ES-module/TypeScript graph is M0-b, deliberately not here.
 *
 * Layout:
 *   web/                 Vite root — the three HTML entry points
 *   web/public/          publicDir — shared.js/app.js/portal.js/pay.js/styles.css,
 *                        copied verbatim to the build root (absolute /app.js,
 *                        /styles.css URLs keep resolving exactly as before)
 *   dist-web/            build output; Express serves it in production
 */
export default defineConfig({
  root: 'web',
  build: {
    outDir: '../dist-web',
    emptyOutDir: true,
    // Relative to `root` (web/): the three multi-page entry points.
    rollupOptions: {
      input: {
        main: 'index.html',
        pay: 'pay.html',
        portal: 'portal.html',
      },
    },
  },
  server: {
    port: 5173,
    // The API runs separately (`npm run dev`) on :3000. Proxy the backend
    // surface so the front-end's relative /api and /health calls work in dev
    // exactly as they do when Express serves everything in prod.
    proxy: {
      '/api': 'http://localhost:3000',
      '/health': 'http://localhost:3000',
    },
  },
  plugins: [
    // Dev parity for the clean URLs Express exposes in prod (`/pay`, `/portal`).
    // Vite serves pay.html/portal.html; rewrite the extensionless paths to them
    // so an emailed /pay?t=... link opens under the dev server too.
    {
      name: 'petpro-clean-urls-dev',
      configureServer(server) {
        server.middlewares.use((req, _res, next) => {
          if (req.url) {
            const [path, query] = req.url.split('?');
            if (path === '/pay') req.url = '/pay.html' + (query ? '?' + query : '');
            else if (path === '/portal') req.url = '/portal.html' + (query ? '?' + query : '');
          }
          next();
        });
      },
    },
  ],
});
