/** The short git commit SHA this exact build was made from (docker/Dockerfile.server bakes it
 * in as VITE_APP_VERSION at build time from build-images.yml's own github.sha) — so it's
 * possible to tell, on a real device, whether it's actually running the build just pushed
 * rather than one stuck behind a stale service-worker cache, instead of guessing from behavior
 * alone. "dev" outside a real build (local `npm run dev:web`, where no such build-arg exists). */
export const APP_VERSION: string = (import.meta.env.VITE_APP_VERSION as string | undefined)?.slice(0, 7) || "dev";

function clearAllCookies(): void {
  for (const cookie of document.cookie.split(";")) {
    const name = cookie.split("=")[0]?.trim();
    if (!name) continue;
    document.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/`;
  }
}

/** Unregisters every service worker, empties every Cache Storage entry this origin owns, clears
 * cookies and local/session storage, then hard-reloads — the definitive fix for "the app is
 * stuck on an old build" or a broken session, offered right on the sign-in screen since nobody
 * is signed in yet at that point (unlike a logged-in screen, there's no unsynced work to lose by
 * being this aggressive). */
export async function clearCacheAndCookies(): Promise<void> {
  if ("serviceWorker" in navigator) {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.map((r) => r.unregister()));
  }
  if ("caches" in window) {
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => caches.delete(k)));
  }
  clearAllCookies();
  try {
    localStorage.clear();
    sessionStorage.clear();
  } catch {
    // best-effort — a private window / blocked storage just means there was nothing to clear
  }
  window.location.reload();
}
