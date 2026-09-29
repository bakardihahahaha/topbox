import { useEffect, useRef } from "react";

// One shared list, not one addEventListener per hook instance — this hook is only ever mounted
// once (App.tsx), but keeping the listener setup this explicit makes it obvious exactly what
// counts as "activity" without having to cross-reference several individual addEventListener
// calls scattered through the effect below.
const ACTIVITY_EVENTS = ["pointerdown", "keydown", "wheel", "touchstart"] as const;

/** Client-side half of idle sign-out — the SERVER already enforces the real timeout on every
 * request (see AuthService.resolveSession), so this is purely about UX: without it, a stale-out
 * would only ever be discovered the next time the operator tries to save something and it just
 * fails, with no explanation. This calls onIdle proactively, on the same schedule, so the
 * sign-out is a clean, explained screen instead of a confusing failed save. minutes <= 0 disables
 * the timer entirely (matches "0 = disabled" everywhere else this setting is used). */
export function useIdleLogout(minutes: number, onIdle: () => void): void {
  const onIdleRef = useRef(onIdle);
  onIdleRef.current = onIdle;

  useEffect(() => {
    if (minutes <= 0) return;
    const timeoutMs = minutes * 60_000;
    let timer: ReturnType<typeof setTimeout>;

    function reset() {
      clearTimeout(timer);
      timer = setTimeout(() => onIdleRef.current(), timeoutMs);
    }

    reset();
    for (const event of ACTIVITY_EVENTS) window.addEventListener(event, reset, { passive: true });
    return () => {
      clearTimeout(timer);
      for (const event of ACTIVITY_EVENTS) window.removeEventListener(event, reset);
    };
  }, [minutes]);
}
