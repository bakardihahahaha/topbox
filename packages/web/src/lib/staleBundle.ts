// After a new version is deployed, a tab that was already open still runs the old app, and the
// parts it loads only when needed (the PDF maker, the PDF viewer, the Excel export) have new file
// names on the server — the old ones are gone. Loading one then fails ("Failed to fetch
// dynamically imported module"). Instead of an error, the app reloads itself onto the new
// version; the user just taps the button again. A guard stops a reload loop if the server itself
// is the problem.
const KEY = "biosite-signoff.stale-reload";

export function isStaleBundleError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /dynamically imported module|Importing a module script failed|error loading dynamically imported|Unable to preload CSS|ChunkLoadError/i.test(msg);
}

/** Reloads onto the newest version — at most once a minute. Returns false if it just did. */
export function reloadForNewVersion(): boolean {
  try {
    const last = Number(sessionStorage.getItem(KEY) || 0);
    if (Date.now() - last < 60_000) return false;
    sessionStorage.setItem(KEY, String(Date.now()));
  } catch {
    // no sessionStorage — still reload once
  }
  const done = () => window.location.reload();
  const sw = "serviceWorker" in navigator ? navigator.serviceWorker.getRegistration().then((r) => r?.update()) : Promise.resolve();
  // Fetch the new version first (bounded), then reload.
  void Promise.race([sw, new Promise((r) => setTimeout(r, 2000))]).then(done, done);
  return true;
}

/** `import()` of a lazily loaded part, reloading onto the new version if this tab is outdated. */
export async function lazyImport<T>(load: () => Promise<T>): Promise<T> {
  try {
    return await load();
  } catch (err) {
    if (isStaleBundleError(err) && reloadForNewVersion()) {
      throw new Error("The app was just updated — reloading the new version. Tap the button again in a moment.");
    }
    throw err;
  }
}

export function initStaleBundleReload(): void {
  // Vite's own signal for a lazily loaded file that failed to load.
  window.addEventListener("vite:preloadError", (e) => {
    if (reloadForNewVersion()) e.preventDefault();
  });
}
