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

export async function fetchSignoffTypes(): Promise<SignoffType[]> {
  const types = await getJson<SignoffType[]>("/api/signoff-types");
  try {
    localStorage.setItem(KEY, JSON.stringify(types));
  } catch {
    // best-effort
  }
  return types;
}

export const saveSignoffTypes = (types: SignoffType[]) => sendJson<SignoffType[]>("PUT", "/api/signoff-types", types);

export function useSignoffTypes(): SignoffType[] {
  const [types, setTypes] = useState<SignoffType[]>(cached);
  useEffect(() => {
    const load = () => void fetchSignoffTypes().then(setTypes, () => {});
    load();
    return onDataChange(load);
  }, []);
  return types;
}
