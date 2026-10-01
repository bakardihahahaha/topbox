import { useSyncExternalStore } from "react";

// Whole-interface size for big touch screens (24–30" kiosks, operators in gloves). Scales every
// button, field, check box and the PIN keypad together via CSS zoom on #root (see tokens.css), so
// no screen needs its own "big mode". Starts at Normal on every fresh page load.
export type TouchSize = "normal" | "large" | "xl";

const KEY = "biosite-signoff.touch-size";
const ZOOM: Record<TouchSize, number> = { normal: 1, large: 1.35, xl: 1.65 };
const LABEL: Record<TouchSize, string> = { normal: "Size: Normal", large: "Size: Large", xl: "Size: XL" };
const ORDER: TouchSize[] = ["normal", "large", "xl"];

/** Every fresh page load starts at Normal — Large / XL last only until the page is reloaded or
 * opened again. (Older builds remembered the choice; that is cleared.) */
function stored(): TouchSize {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // best-effort
  }
  return "normal";
}

let current: TouchSize = typeof window === "undefined" ? "normal" : stored();
const listeners = new Set<() => void>();

function apply(): void {
  document.documentElement.style.setProperty("--zoom", String(ZOOM[current]));
}

export function initTouchSize(): void {
  apply();
}

export function cycleTouchSize(): void {
  current = ORDER[(ORDER.indexOf(current) + 1) % ORDER.length]!;
  apply();
  listeners.forEach((l) => l());
}

export function useTouchSizeLabel(): string {
  const size = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => current,
  );
  return LABEL[size];
}
