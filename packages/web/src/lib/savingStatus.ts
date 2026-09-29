import { useSyncExternalStore } from "react";

// A simple in-flight counter rather than a boolean, since overlapping saves (e.g. two item
// mutations firing close together) must not let the first one's completion turn the indicator
// off while the second is still writing.
let inFlight = 0;
// Every change is applied to the local view immediately (see ReportEditPage's withQueue and
// friends) — the network round trip that persists it is a background detail, not something the
// operator waits on. So this indicator deliberately does NOT flip on the instant a save starts:
// on a normal connection a save resolves well inside SHOW_DELAY_MS and the bar/dot never
// appears at all. It only shows up once something is genuinely slow (a weak signal, a large
// request), which is the one case worth surfacing.
const SHOW_DELAY_MS = 400;
let visible = false;
let showTimer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  listeners.forEach((l) => l());
}

export async function withSaving<T>(fn: () => Promise<T>): Promise<T> {
  inFlight += 1;
  emit(); // useSavingCount below needs to see every change, not just the debounced show/hide ones
  if (inFlight === 1 && !showTimer) {
    showTimer = setTimeout(() => {
      showTimer = null;
      if (inFlight > 0 && !visible) {
        visible = true;
        emit();
      }
    }, SHOW_DELAY_MS);
  }
  try {
    return await fn();
  } finally {
    inFlight = Math.max(0, inFlight - 1);
    emit();
    if (inFlight === 0) {
      if (showTimer) {
        clearTimeout(showTimer);
        showTimer = null;
      }
      if (visible) {
        visible = false;
        emit();
      }
    }
  }
}

export function useSaving(): boolean {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => visible,
  );
}

/** The raw, undebounced count of saves currently in flight — e.g. how many items a just-picked
 * batch is still waiting on confirmation for. Unlike useSaving() above (which only flips once
 * something has stayed in flight past SHOW_DELAY_MS, so a normal fast save never flashes any UI
 * at all), this always reflects the true current number — SavingIndicator only surfaces it once
 * useSaving() has already decided to show something, so a fast save still shows nothing, but a
 * sync the operator can actually see happening no longer shows a bare "Saving…" with no count. */
export function useSavingCount(): number {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => inFlight,
  );
}
