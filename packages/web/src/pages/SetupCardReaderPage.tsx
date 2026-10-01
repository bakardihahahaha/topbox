import { useEffect, useRef, useState } from "react";
import { lookupCard } from "../lib/api.js";
import { useCardReader } from "../lib/cardReader.js";
import { SetupSubNav } from "../components/SetupSubNav.js";
import { card, chip, errorBox, errorMessage, ghost, h1, hint, infoBox, page } from "../lib/ui.js";

/** One run of keys from the reader (or a person) — split where nothing came for a while. */
interface Burst {
  id: number;
  keys: { key: string; gap: number }[];
  endedWith: "Enter" | "Tab" | null;
  at: Date;
}

const NEW_BURST_AFTER_MS = 400;
/** The sign-in screen's rule (lib/cardReader.ts): every key within this of the one before. */
const READER_GAP_MS = 60;

/**
 * Setup → Card reader: tap a card and see exactly what the reader sends — every key and how fast —
 * whether the sign-in screen would take it as a card, and whose card it is.
 */
export function SetupCardReaderPage() {
  const [bursts, setBursts] = useState<Burst[]>([]);
  const [detected, setDetected] = useState<{ raw: string; normalized: string; user: { id: string; name: string } | null; at: Date } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const last = useRef(0);
  const nextId = useRef(1);

  // Raw view: every key the page receives.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === "Shift" || e.key === "CapsLock") return;
      const now = performance.now();
      const gap = last.current ? Math.round(now - last.current) : 0;
      last.current = now;
      if (e.key === "Enter" || e.key === "Tab") e.preventDefault();
      setBursts((cur) => {
        const open = cur[0];
        const startNew = !open || open.endedWith !== null || gap > NEW_BURST_AFTER_MS;
        if (e.key === "Enter" || e.key === "Tab") {
          if (startNew) return cur;
          return [{ ...open, endedWith: e.key as "Enter" | "Tab" }, ...cur.slice(1)];
        }
        if (e.key.length !== 1) return cur;
        if (startNew) return [{ id: nextId.current++, keys: [{ key: e.key, gap: 0 }], endedWith: null, at: new Date() }, ...cur].slice(0, 10);
        return [{ ...open, keys: [...open.keys, { key: e.key, gap }] }, ...cur.slice(1)];
      });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // The same detector the sign-in screen uses.
  useCardReader(async (raw) => {
    setError(null);
    try {
      const r = await lookupCard(raw);
      setDetected({ raw, ...r, at: new Date() });
    } catch (err) {
      setError(errorMessage(err));
    }
  });

  return (
    <div style={page}>
      <h1 style={h1}>Setup</h1>
      <SetupSubNav />
      <p style={hint}>
        Test the RFID card reader here. Plug it into this device and tap a card on it — nothing needs to be clicked first. A reader that works shows the card number below within a second.
      </p>

      <div style={{ ...card, marginBottom: 12, textAlign: "center", padding: 24 }}>
        {detected ? (
          <>
            <div style={{ fontSize: 13, color: "var(--text-3)", marginBottom: 6 }}>Card read at {detected.at.toLocaleTimeString()}</div>
            <div className="mono" style={{ fontSize: 30, fontWeight: 700, letterSpacing: ".06em", wordBreak: "break-all" }}>
              {detected.normalized}
            </div>
            <div style={{ fontSize: 12.5, color: "var(--text-3)", margin: "6px 0 12px" }}>
              {detected.normalized.length} characters{detected.raw !== detected.normalized ? ` · as sent: ${detected.raw}` : ""}
            </div>
            {detected.user ? (
              <span style={{ ...chip("accent"), fontSize: 13 }}>✓ Assigned to {detected.user.name} — this card signs them in</span>
            ) : (
              <span style={{ ...chip("warn"), fontSize: 13 }}>Not assigned to anyone yet — assign it in Setup → Users</span>
            )}
          </>
        ) : (
          <>
            <div style={{ fontSize: 40, marginBottom: 6 }}>📶</div>
            <div style={{ fontSize: 18, fontWeight: 700 }}>Tap a card on the reader…</div>
            <div style={{ fontSize: 13, color: "var(--text-3)", marginTop: 6 }}>Waiting for a card.</div>
          </>
        )}
      </div>
      {error && <div style={errorBox}>{error}</div>}

      <div style={{ ...card, marginBottom: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 8 }}>
          <div style={{ fontWeight: 700 }}>What the reader sends</div>
          <button
            style={ghost}
            onClick={() => {
              setBursts([]);
              setDetected(null);
            }}
          >
            Clear
          </button>
        </div>
        {bursts.length === 0 && <div style={{ fontSize: 13, color: "var(--text-4)" }}>Nothing received yet. If tapping a card shows nothing here, the reader isn&apos;t sending keys — see the tips below.</div>}
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {bursts.map((b) => {
            const gaps = b.keys.slice(1).map((k) => k.gap);
            const maxGap = gaps.length ? Math.max(...gaps) : 0;
            const avg = gaps.length ? Math.round(gaps.reduce((a, g) => a + g, 0) / gaps.length) : 0;
            const fast = b.keys.length >= 4 && maxGap <= READER_GAP_MS;
            return (
              <div key={b.id} style={{ border: "1px solid var(--border-soft)", borderRadius: "var(--radius-control)", padding: "10px 12px" }}>
                <div className="mono" style={{ fontSize: 17, fontWeight: 700, wordBreak: "break-all" }}>
                  {b.keys.map((k) => k.key).join("")}
                  {b.endedWith && <span style={{ color: "var(--text-3)", fontWeight: 400 }}> ⏎{b.endedWith === "Tab" ? " (Tab)" : ""}</span>}
                </div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6, alignItems: "center" }}>
                  <span style={chip("muted")}>{b.keys.length} characters</span>
                  <span style={chip(b.endedWith ? "accent" : "warn")}>{b.endedWith ? `ends with ${b.endedWith}` : "no Enter at the end"}</span>
                  {gaps.length > 0 && <span style={chip(fast ? "accent" : "warn")}>{fast ? `fast: ${avg} ms per key — reader` : `slow: up to ${maxGap} ms per key — typed by hand?`}</span>}
                  <span style={{ fontSize: 11.5, color: "var(--text-4)" }}>{b.at.toLocaleTimeString()}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div style={infoBox}>
        <b>Nothing appears when you tap a card?</b> The reader isn&apos;t in keyboard mode. Check: it&apos;s plugged into <i>this</i> device (USB, or USB-C adapter on an iPad), its light / beep
        reacts to the card, and it&apos;s set to keyboard (HID / &quot;keyboard emulation&quot;) output — many readers switch with the maker&apos;s tool or a setup card. Same card should always give
        the same number; if it ends without Enter it still works (the sign-in screen waits a moment).
      </div>
    </div>
  );
}
