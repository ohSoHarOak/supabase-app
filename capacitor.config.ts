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
  appName: 'Sit.Stay.Play',
  webDir: 'dist-web',

  // T-3 follow-up. Capacitor's native bridge echoes every plugin call RESULT to
  // the console, and Capacitor forwards console output to Android's logcat. With
  // secure storage in the call path that means the access AND refresh tokens get
  // written to a system log in plaintext -- observed on-device 2026-08-24 as
  // `I/Capacitor/Console: {"data":"<access token>"}`.
  //
  // That is the same threat model T-3 just closed (rooted / forensically-imaged
  // device, or anyone with adb), so moving tokens into Keystore while logging
  // them would have been self-defeating.
  //
  // The default is 'debug' (log only in debug builds), which would probably
  // spare release APKs -- but debug APKs are exactly what gets sideloaded for
  // testing, against a REAL production account. Pinned to 'none' so neither
  // build type can leak a credential, rather than trusting a default.
  loggingBehavior: 'none',
};

export default config;
