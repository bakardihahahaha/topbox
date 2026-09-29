// Browsers only re-check a registered service worker's script for changes on navigation, and even
// then at most once every 24h unless something asks sooner — so a PWA left open in the background
// (exactly how it's meant to be used, that's the whole point of "install") can sit on a bundle from
// hours or days ago indefinitely. registerType:"autoUpdate" (vite.config.ts) already makes a found
// update self-activate and reload the page with no prompt (skipWaiting + clientsClaim baked into the
// generated SW, "activated" listener in the injected register script) — the missing piece is asking
// often enough. This calls registration.update() whenever the tab regains focus/visibility and on a
// standing interval while visible, so a deployed fix reaches an already-open tab within minutes
// instead of whenever the browser next feels like checking on its own.
const CHECK_INTERVAL_MS = 5 * 60 * 1000;

export function initPwaUpdateCheck(): void {
  if (!("serviceWorker" in navigator)) return;

  function checkForUpdate(): void {
    if (document.visibilityState !== "visible") return;
    navigator.serviceWorker.getRegistration().then((reg) => reg?.update()).catch(() => {});
  }

  document.addEventListener("visibilitychange", checkForUpdate);
  window.addEventListener("focus", checkForUpdate);
  setInterval(checkForUpdate, CHECK_INTERVAL_MS);
  checkForUpdate();
}
