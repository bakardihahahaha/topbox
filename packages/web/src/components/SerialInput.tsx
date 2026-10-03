import { useEffect, useRef, useState, type CSSProperties } from "react";
import { input as inputStyle } from "../lib/ui.js";

/**
 * Serial-number entry with the app's own number keypad (the same keys as the PIN pad on the
 * sign-in screen) instead of the device's keyboard — operators only ever type digits; the
 * refurbished "R" has its own button. A laptop / hardware keyboard types straight in too.
 *
 *  - inline: the keypad sits right under the field (New sign-off screen — nothing to cover).
 *  - otherwise: tapping the field opens the keypad as a small window, with the value on top; the
 *    value updates live (search as you type); ✕ or a tap outside closes it.
 */
export function SerialInput(props: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  inline?: boolean;
  /** Enter pressed on a hardware keyboard (inline) / the keypad window closed with Enter. */
  onDone?: () => void;
  style?: CSSProperties;
  ariaLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const field = (
    <input
      value={props.value}
      readOnly
      // Never the device keyboard — the keypad below / in the window does the typing.
      inputMode="none"
      autoComplete="off"
      aria-label={props.ariaLabel ?? "Serial number"}
      placeholder={props.placeholder}
      onClick={() => !props.inline && setOpen(true)}
      onKeyDown={(e) => {
        // While the keypad is up (window or inline) it handles the keys itself.
        if (open || props.inline) return;
        if (e.key === "Enter") props.onDone?.();
        // Typing on a laptop straight into the (closed) search field just types — no keypad needed.
        else if (!e.ctrlKey && !e.metaKey && !e.altKey) {
          if (/^[0-9A-Za-z\-\/.]$/.test(e.key)) props.onChange(props.value + e.key.toUpperCase());
          else if (e.key === "Backspace") props.onChange(props.value.slice(0, -1));
        }
      }}
      className="mono"
      style={{ ...inputStyle, height: 56, fontSize: 20, cursor: props.inline ? "default" : "pointer", ...props.style }}
    />
  );

  if (props.inline) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {field}
        <Keypad value={props.value} onChange={props.onChange} onEnter={props.onDone} />
      </div>
    );
  }

  return (
    <>
      {field}
      {open && (
        <div role="dialog" aria-modal="true" aria-label="Serial number keypad" onClick={() => setOpen(false)} style={{ position: "fixed", inset: 0, background: "rgba(10,12,14,.6)", zIndex: 9000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: "min(94vw, 380px)", maxHeight: "94vh", overflowY: "auto", background: "var(--bg-base)", border: "1px solid var(--border-soft)", borderRadius: "var(--radius-card)", padding: 18, display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ display: "flex", gap: 8, alignItems: "stretch" }}>
              <div className="mono" style={{ ...inputStyle, flex: 1, height: 56, fontSize: 26, display: "flex", alignItems: "center", justifyContent: "center", letterSpacing: ".08em", color: props.value ? "var(--text)" : "var(--text-4)" }}>
                {props.value || props.placeholder || "Serial number"}
              </div>
              <button type="button" onClick={() => setOpen(false)} aria-label="Close keypad" style={{ ...closeButton }}>
                ✕
              </button>
            </div>
            <Keypad
              value={props.value}
              onChange={props.onChange}
              onEnter={() => {
                setOpen(false);
                props.onDone?.();
              }}
              onClose={() => setOpen(false)}
            />
          </div>
        </div>
      )}
    </>
  );
}

function Keypad({ value, onChange, onEnter, onClose }: { value: string; onChange: (v: string) => void; onEnter?: () => void; onClose?: () => void }) {
  // A laptop / hardware keyboard works too while the keypad is up: any letter, digit or dash is
  // typed in, Backspace deletes, Enter closes the keypad window (e.g. shows the search results),
  // Escape closes it too.
  const valueRef = useRef(value);
  valueRef.current = value;
  const cb = useRef({ onChange, onEnter, onClose });
  cb.current = { onChange, onEnter, onClose };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement && !e.target.readOnly) return;
      if (e.target instanceof HTMLTextAreaElement || e.ctrlKey || e.metaKey || e.altKey) return;
      if (/^[0-9A-Za-z\-\/.]$/.test(e.key)) {
        e.preventDefault();
        cb.current.onChange(valueRef.current + e.key.toUpperCase());
      } else if (e.key === "Backspace") {
        e.preventDefault();
        cb.current.onChange(valueRef.current.slice(0, -1));
      } else if (e.key === "Enter") {
        e.preventDefault();
        cb.current.onEnter?.();
      } else if (e.key === "Escape") {
        cb.current.onClose?.();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
      {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
        <button key={d} type="button" onClick={() => onChange(value + d)} style={keypadKey}>
          {d}
        </button>
      ))}
      <button type="button" onClick={() => onChange("")} style={{ ...keypadKey, fontSize: 16, color: "var(--text-2)" }}>
        Clear
      </button>
      <button type="button" onClick={() => onChange(value + "0")} style={keypadKey}>
        0
      </button>
      <button type="button" onClick={() => onChange(value.slice(0, -1))} style={{ ...keypadKey, fontSize: 20 }} aria-label="Delete">
        ⌫
      </button>
    </div>
  );
}

/** One key of the number keypad — exported so buttons next to it (e.g. +R) look the same. */
export const keypadKey: CSSProperties = {
  height: 68,
  borderRadius: "var(--radius-control)",
  border: "1px solid var(--border)",
  background: "var(--bg-deep)",
  color: "var(--text)",
  fontSize: 24,
  fontWeight: 600,
  cursor: "pointer",
};

const closeButton: CSSProperties = {
  width: 56,
  flex: "none",
  borderRadius: "var(--radius-control)",
  border: "1px solid var(--border)",
  background: "transparent",
  color: "var(--text-2)",
  fontSize: 20,
  fontWeight: 700,
  cursor: "pointer",
};
