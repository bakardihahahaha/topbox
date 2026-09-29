import { useSyncExternalStore } from "react";

// Whole-interface size for big touch screens (24–30" kiosks, operators in gloves). Scales every
// button, field, check box and the PIN keypad together via CSS zoom on #root (see tokens.css), so
// no screen needs its own "big mode". Chosen per device and remembered there.
export type TouchSize = "normal" | "large" | "xl";

const KEY = "biosite-signoff.touch-size";
const ZOOM: Record<TouchSize, number> = { normal: 1, large: 1.35, xl: 1.65 };
const LABEL: Record<TouchSize, string> = { normal: "Size: Normal", large: "Size: Large", xl: "Size: XL" };
const ORDER: TouchSize[] = ["normal", "large", "xl"];

/** A touch screen that's also a big screen (not a phone) starts at Large. */
function autoSize(): TouchSize {
  try {
    const touch = window.matchMedia("(any-pointer: coarse)").matches;
    return touch && Math.min(window.screen.width, window.screen.height) >= 700 ? "large" : "normal";
  } catch {
    return "normal";
  }
}

function stored(): TouchSize {
  try {
    const v = localStorage.getItem(KEY);
    return v === "normal" || v === "large" || v === "xl" ? v : autoSize();
  } catch {
    return autoSize();
  }
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
  try {
    localStorage.setItem(KEY, current);
  } catch {
    // best-effort
  }
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
