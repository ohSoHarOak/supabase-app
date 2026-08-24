/* Token storage seam (Workstream M / M0.5).

   WHY THIS EXISTS
   The Supabase access + refresh tokens are the only real secrets the client
   holds. On the web they live in localStorage; on the native Android shell they
   should live in Keystore-backed secure storage instead, so a rooted or
   forensically-imaged device can't read them at rest. This module is the single
   place that difference is expressed.

   WHY THE API IS ASYNC
   localStorage is synchronous, so `await` here looks pointless today — it isn't.
   Every Capacitor secure-storage plugin is promise-based, so if callers were
   written against a synchronous API, adding the plugin would mean rewriting
   every call site. Async now = the plugin is a change to THIS FILE ONLY.

   WHAT DOES *NOT* BELONG HERE
   Only secrets. The cached account, profile, and queued message drafts stay in
   plain localStorage: they aren't credentials, and Keystore-backed storage is
   slower and size-limited. Backup exfiltration of that cache is already closed
   separately by `android:allowBackup="false"` + the data-extraction rules.
*/

/** Default backend: Web Storage. Correct for the browser build, and the
 *  fallback if a native build hasn't installed a secure backend yet. */
const webBackend = {
  async get(key) {
    return localStorage.getItem(key);
  },
  async set(key, value) {
    localStorage.setItem(key, value);
  },
  async remove(key) {
    localStorage.removeItem(key);
  },
};

let backend = webBackend;

/**
 * Install a Keystore-backed implementation (native builds only). Must expose
 * the same three async methods. Call it BEFORE the first read — i.e. during
 * boot, ahead of restoring the session — or the first load will come back
 * empty and log the user out.
 */
export function setSecureBackend(impl) {
  backend = impl;
}

/** True when tokens are still going to Web Storage — used by the boot log so
 *  it's obvious on-device whether the secure backend actually took effect. */
export function isUsingWebBackend() {
  return backend === webBackend;
}

/**
 * One store per surface: the professional app and the owner portal keep
 * separate sessions, so they get separate keys but share this machinery.
 */
export function createTokenStore({ accessKey, refreshKey }) {
  return {
    async load() {
      const [access, refresh] = await Promise.all([backend.get(accessKey), backend.get(refreshKey)]);
      return { access: access ?? null, refresh: refresh ?? null };
    },

    /** Supabase rotates the refresh token on every refresh, so this always
     *  writes both — persisting only the access token would break the *next*
     *  refresh with a token that has already been consumed. */
    async save({ access, refresh }) {
      await Promise.all([
        access ? backend.set(accessKey, access) : backend.remove(accessKey),
        refresh ? backend.set(refreshKey, refresh) : backend.remove(refreshKey),
      ]);
    },

    async clear() {
      await Promise.all([backend.remove(accessKey), backend.remove(refreshKey)]);
    },
  };
}
