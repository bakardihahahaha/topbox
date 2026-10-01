import { useEffect, useRef } from "react";

/**
 * USB RFID (MIFARE) readers in keyboard mode "type" the card number very fast and press Enter.
 * This tells such a burst apart from a person typing: every key within a few dozen milliseconds
 * of the previous one. Some readers send no Enter — a fast burst that just stops counts too.
 */
const MAX_GAP_MS = 60;
const MIN_LENGTH = 4;

export function useCardReader(onCard: (card: string) => void, enabled = true) {
  const cb = useRef(onCard);
  cb.current = onCard;
  useEffect(() => {
    if (!enabled) return;
    let buf = "";
    let last = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = () => {
      const card = buf;
      buf = "";
      if (card.length >= MIN_LENGTH) cb.current(card);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const now = performance.now();
      if (now - last > MAX_GAP_MS) buf = "";
      last = now;
      clearTimeout(timer);
      if (e.key === "Enter" || e.key === "Tab") {
        if (buf.length >= MIN_LENGTH) {
          e.preventDefault();
          finish();
        }
        buf = "";
        return;
      }
      if (/^[0-9A-Za-z]$/.test(e.key)) {
        buf += e.key;
        // No Enter from the reader: a long fast burst that stops is a card too.
        timer = setTimeout(() => buf.length >= 8 && finish(), 200);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      clearTimeout(timer);
    };
  }, [enabled]);
}
