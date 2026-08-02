import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Capacitor config (Workstream M / M0-e) — wraps the built web app (dist-web)
 * into an Android shell. Still one deployable, same backend.
 *
 * No `server.url`: the app ships its web assets ON-DEVICE (webDir) and reaches
 * the backend over HTTPS through API_BASE (web/src/config.js, set at build time
 * via VITE_API_BASE). The Android webview serves those assets from the origin
 * https://localhost — which the API's CORS allowlist must permit (M0-f).
 *
 * appId is the Play Store package name and is painful to change later; confirm
 * `com.petpro.connect` before the first Play upload.
 */
const config: CapacitorConfig = {
  appId: 'com.petpro.connect',
  appName: 'PetPro Connect',
  webDir: 'dist-web',
};

export default config;
