import { useEffect, useState } from "react";
import { DEFAULT_SIGNOFF_TYPES, type SignoffType } from "@biosite-signoff/shared";
import { getJson, sendJson } from "./client.js";
import { onDataChange } from "./liveEvents.js";

// The New sign-off screen's buttons (Setup → Types). Remembered on the device so the buttons
// still show when starting a sign-off offline.
const KEY = "biosite-signoff.signoff-types";

function cached(): SignoffType[] {
  try {
    return (JSON.parse(localStorage.getItem(KEY) ?? "null") as SignoffType[] | null) ?? DEFAULT_SIGNOFF_TYPES;
  } catch {
    return DEFAULT_SIGNOFF_TYPES;
  }
}

/** Remembers the list on this device (also right after a local, not-yet-synced edit). */
export function rememberSignoffTypes(types: SignoffType[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(types));
  } catch {
    // best-effort
  }
  listeners.forEach((l) => l(types));
}

const listeners = new Set<(t: SignoffType[]) => void>();

export async function fetchSignoffTypes(): Promise<SignoffType[]> {
  try {
    const types = await getJson<SignoffType[]>("/api/signoff-types");
    rememberSignoffTypes(types);
    return types;
  } catch (err) {
    if (localStorage.getItem(KEY)) return cached(); // offline: last known list
    throw err;
  }
}

export const saveSignoffTypes = (types: SignoffType[]) => sendJson<SignoffType[]>("PUT", "/api/signoff-types", types);

export function useSignoffTypes(): SignoffType[] {
  const [types, setTypes] = useState<SignoffType[]>(cached);
  useEffect(() => {
    const load = () => void fetchSignoffTypes().then(setTypes, () => {});
    load();
    listeners.add(setTypes);
    const off = onDataChange(load);
    return () => {
      listeners.delete(setTypes);
      off();
    };
  }, []);
  return types;
}
