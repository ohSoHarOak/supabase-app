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
 * T-3: install the Keystore-backed backend on native builds.
 *
 * Must be awaited BEFORE the first `load()` — the seam's contract above — so
 * boot calls it ahead of restoring the session.
 *
 * The plugin's `StorageLikeAsync` trio (`getItem`/`setItem`/`removeItem`) maps
 * one-to-one onto this seam. Deliberately NOT its `get`/`set` pair: those
 * JSON-serialize and would hand back a non-string for a token that merely looks
 * numeric.
 *
 * ⚠️ **Falls back to localStorage rather than failing closed.** A device whose
 * Keystore is unavailable would otherwise be unable to log in at all, which is
 * worse than the at-rest exposure this closes — the tokens are a ~1h access
 * token plus a rotating refresh token, not a password. The fallback is loud
 * (console.error + `isUsingWebBackend()`) so it can't pass for success on a
 * device test.
 */
export async function initSecureStorage() {
  if (!window.Capacitor?.isNativePlatform?.()) return { secure: false, reason: 'web build' };
  try {
    const { SecureStorage } = await import('@aparajita/capacitor-secure-storage');
    setSecureBackend({
      get: (key) => SecureStorage.getItem(key),
      set: (key, value) => SecureStorage.setItem(key, value),
      remove: (key) => SecureStorage.removeItem(key),
    });
    console.info('[tokenStore] Keystore-backed secure storage active.');
    return { secure: true };
  } catch (err) {
    const reason = err?.message ?? String(err);
    console.error('[tokenStore] secure storage unavailable — tokens staying in localStorage:', reason);
    return { secure: false, reason };
  }
}

/**
 * One store per surface: the professional app and the owner portal keep
 * separate sessions, so they get separate keys but share this machinery.
 */
export function createTokenStore({ accessKey, refreshKey }) {
  return {
    async load() {
      let [access, refresh] = await Promise.all([backend.get(accessKey), backend.get(refreshKey)]);

      // T-3 migration. A phone upgrading from a pre-Keystore build still has
      // its tokens in localStorage. Two things have to happen, and the second
      // matters more than the first:
      //   1. Adopt them, so the upgrade doesn't silently log the walker out.
      //   2. PURGE the plaintext copy. Moving tokens to Keystore while leaving
      //      a readable duplicate behind would close nothing at all.
      // Guarded on the native backend: on web, `backend` IS localStorage, so
      // this would read and delete the very values it just returned.
      if (!isUsingWebBackend()) {
        if (!access && !refresh) {
          const legacyAccess = localStorage.getItem(accessKey);
          const legacyRefresh = localStorage.getItem(refreshKey);
          if (legacyAccess || legacyRefresh) {
            access = legacyAccess;
            refresh = legacyRefresh;
            await Promise.all([
              legacyAccess ? backend.set(accessKey, legacyAccess) : Promise.resolve(),
              legacyRefresh ? backend.set(refreshKey, legacyRefresh) : Promise.resolve(),
            ]);
            console.info('[tokenStore] migrated tokens from localStorage into secure storage.');
          }
        }
        // Unconditional: also clears a stale plaintext pair left behind when
        // secure storage already held the live session.
        localStorage.removeItem(accessKey);
        localStorage.removeItem(refreshKey);
      }

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
