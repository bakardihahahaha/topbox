import type { Signoff } from "@biosite-signoff/shared";

// Last known copy of each sign-off opened on this device (memory + localStorage), so a sign-off
// created or edited while offline can still be opened and worked on before it reaches the NAS.
const KEY = "biosite-signoff.cache";
const MAX = 30;

function readAll(): Record<string, Signoff> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}") as Record<string, Signoff>;
  } catch {
    return {};
  }
}

export function cacheSignoff(s: Signoff): void {
  try {
    const all = readAll();
    all[s.id] = s;
    const ids = Object.keys(all).sort((a, b) => all[b]!.updatedAt.localeCompare(all[a]!.updatedAt));
    for (const id of ids.slice(MAX)) delete all[id];
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    // storage full / blocked — the cache is only a convenience
  }
}

export function cachedSignoff(id: string): Signoff | null {
  return readAll()[id] ?? null;
}

export function forgetSignoff(id: string): void {
  try {
    const all = readAll();
    delete all[id];
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    // ignore
  }
}
