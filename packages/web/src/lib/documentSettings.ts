import { useEffect, useState } from "react";
import { DEFAULT_DOCUMENT_SETTINGS, type DocumentSettings } from "@biosite-signoff/shared";
import { getJsonCached } from "./client.js";
import { onDataChange } from "./liveEvents.js";
import { stamp } from "./format.js";

/** Setup → Document settings for screens (cached on the device, refreshed on every change). */
export function useDocumentSettings(): DocumentSettings {
  const [s, setS] = useState<DocumentSettings>(DEFAULT_DOCUMENT_SETTINGS);
  useEffect(() => {
    const load = () => void getJsonCached<DocumentSettings>("/api/document-settings").then((d) => setS({ ...DEFAULT_DOCUMENT_SETTINGS, ...d }), () => {});
    load();
    return onDataChange(load);
  }, []);
  return s;
}

/** Whether signature times are shown (Setup → Document). */
export const useShowSignTime = () => useDocumentSettings().showSignTime;

/** "2026-09-29 14:05" -> "29/09/2026 14:05", or just the date when times are switched off. */
export const signStamp = (s: string | null | undefined, showTime: boolean) => stamp(s && !showTime ? s.slice(0, 10) : s);
