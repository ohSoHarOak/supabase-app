/* Front-end runtime config (Workstream M / M0-b).

   API_BASE is the origin the REST API lives at.
   - Web build (served by Express): empty string -> same-origin relative
     "/api/..." calls, exactly as before.
   - Native Android build (Capacitor): the wrapped app loads its assets from
     the device, so it must call the backend absolutely. The Capacitor build
     sets VITE_API_BASE to the deployed origin (e.g. https://<app>.onrender.com)
     and every fetch is prefixed with it.

   Vite inlines import.meta.env.VITE_* at build time. Unset -> '' (relative). */
export const API_BASE = import.meta.env.VITE_API_BASE ?? '';
