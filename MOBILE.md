# PetPro Connect — Android app (Workstream M)

The Android app is the **same web app**, wrapped in a native shell with
[Capacitor](https://capacitorjs.com). One codebase, one backend. Native device
features (QR, GPS, camera, push, Tap-to-Pay) get added later as Capacitor
plugins called from the existing UI — see `PHASE_2_ROADMAP.md` → Workstream M.

## How it fits together

```
web/            the app's source (HTML + web/src/*.js), built by Vite
  └─ vite build ─▶ dist-web/         the built web app
                     └─ cap sync ─▶ android/app/.../assets/public   (copied on-device)
android/        the native Android project (open this in Android Studio)
```

- On a phone, the app loads its screens **from the device** (the copied
  `dist-web`), and calls the backend **over the internet**.
- Because of that, the native build must know the backend's address. That's
  `VITE_API_BASE` (see below). On the web, it's blank and calls are same-origin.

## Prerequisites

- **Android Studio** installed (done, 2026-08-01). It brings the Android SDK,
  an emulator, and Gradle — none of which the plain `npm` steps below need, but
  the actual build/run does.

## Build & run on Android

From the repo root (PowerShell):

```powershell
# 1. Point the app at your backend (the deployed API origin). Do NOT add a
#    trailing slash. For founder-only local testing you can use your machine's
#    LAN address instead, e.g. http://192.168.1.20:3000
$env:VITE_API_BASE = "https://<your-app>.onrender.com"

# 2. Build the web app with that API base and copy it into the Android project
npm run build:native

# 3. Open the native project in Android Studio
npm run cap:open
```

Then in Android Studio: pick a device/emulator and press **Run** (▶). The app
installs and launches.

After any change to the web app, re-run steps 1–2 (`npm run build:native`) to
refresh what's on the device, then Run again. `npm run cap:sync` alone re-copies
the current `dist-web` without rebuilding.

## Backend setup for the app

The API's CORS allowlist already permits the Capacitor origins
(`https://localhost` on Android, `capacitor://localhost` on iOS later) by
default — see `src/api/middleware/security.ts`. **No backend env change is
needed** for the app to reach the API. `APP_ORIGINS` remains for any *extra*
browser origins.

## App identity

- **Package name / appId:** `com.petpro.connect` (in `capacitor.config.ts`).
  This is the permanent Play Store identifier — confirm it before the first
  upload; changing it later means a new listing.

## Open item — auth token storage (M0-f review)

Today the web app stores the login JWT in **`localStorage`**
(`petpro_token` in `web/src/app.js`, `petpro_portal_token` in
`web/src/portal.js`). In the Android webview that maps to the app's private
WebView storage — not readable by other apps, but **not OS-encrypted at rest**
and cleared if the user clears app data.

**Recommendation (own follow-up task):** move token storage behind the
[`@capacitor/preferences`](https://capacitorjs.com/docs/apis/preferences) API
(optionally a secure-storage plugin), with `localStorage` as the web fallback.
It's deferred here because the current code reads the token **synchronously at
startup** and Preferences is **async** — doing it right means a small auth-init
refactor in both frontends, best done as its own change rather than folded into
the shell setup. Until then, the `localStorage` approach is acceptable for
founder-only testing.
