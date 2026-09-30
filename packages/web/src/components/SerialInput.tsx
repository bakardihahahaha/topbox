import { useEffect, useRef, useState, type CSSProperties } from "react";
import { input as inputStyle } from "../lib/ui.js";

/**
 * Serial-number entry with the app's own number keypad (the same keys as the PIN pad on the
 * sign-in screen) instead of the device's keyboard — operators only ever type digits; the
 * refurbished "R" has its own button. "ABC" switches to the device keyboard for the rare serial
 * with letters.
 *
 *  - inline: the keypad sits right under the field (New sign-off screen — nothing to cover).
 *  - otherwise: tapping the field opens the keypad as a small window, with the value on top; the
 *    value updates live (search as you type), OK closes it.
 */
export function SerialInput(props: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  inline?: boolean;
  /** Pressed OK (inline) / closed the keypad window. */
  onDone?: () => void;
  style?: CSSProperties;
  ariaLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [letters, setLetters] = useState(false);
  const field = (
    <input
      value={props.value}
      readOnly={!letters}
      // No device keyboard unless "ABC" was chosen.
      inputMode={letters ? "text" : "none"}
      autoCapitalize="characters"
      autoComplete="off"
      aria-label={props.ariaLabel ?? "Serial number"}
      placeholder={props.placeholder}
      onChange={(e) => props.onChange(e.target.value.toUpperCase())}
      onClick={() => !props.inline && !letters && setOpen(true)}
      onKeyDown={(e) => {
        // While the keypad is up (window or inline) it handles the keys itself.
        if (open || (props.inline && !letters)) return;
        if (e.key === "Enter") props.onDone?.();
        // Typing on a laptop straight into the (closed) search field just types — no keypad needed.
        else if (!letters && !props.inline && !e.ctrlKey && !e.metaKey && !e.altKey) {
          if (/^[0-9A-Za-z\-\/.]$/.test(e.key)) props.onChange(props.value + e.key.toUpperCase());
          else if (e.key === "Backspace") props.onChange(props.value.slice(0, -1));
        }
      }}
      className="mono"
      style={{ ...inputStyle, height: 56, fontSize: 20, cursor: letters ? "text" : "pointer", ...props.style }}
    />
  );

  if (props.inline) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {field}
        {letters ? (
          <button type="button" onClick={() => setLetters(false)} style={{ ...modeButton, alignSelf: "flex-start" }}>
            123 keypad
          </button>
        ) : (
          <Keypad value={props.value} onChange={props.onChange} onOk={props.onDone} onLetters={() => setLetters(true)} />
        )}
      </div>
    );
  }

  return (
    <>
      {field}
      {letters && (
        <button type="button" onClick={() => setLetters(false)} style={{ ...modeButton, marginTop: 6 }}>
          123 keypad
        </button>
      )}
      {open && (
        <div role="dialog" aria-modal="true" aria-label="Serial number keypad" onClick={() => setOpen(false)} style={{ position: "fixed", inset: 0, background: "rgba(10,12,14,.6)", zIndex: 9000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: "min(94vw, 380px)", maxHeight: "94vh", overflowY: "auto", background: "var(--bg-base)", border: "1px solid var(--border-soft)", borderRadius: "var(--radius-card)", padding: 18, display: "flex", flexDirection: "column", gap: 14 }}>
            <div className="mono" style={{ ...inputStyle, height: 56, fontSize: 26, display: "flex", alignItems: "center", justifyContent: "center", letterSpacing: ".08em", color: props.value ? "var(--text)" : "var(--text-4)" }}>
              {props.value || props.placeholder || "Serial number"}
            </div>
            <Keypad
              value={props.value}
              onChange={props.onChange}
              onOk={() => {
                setOpen(false);
                props.onDone?.();
              }}
              onLetters={() => {
                setOpen(false);
                setLetters(true);
              }}
              onClose={() => setOpen(false)}
            />
          </div>
        </div>
      )}
    </>
  );
}

function Keypad({ value, onChange, onOk, onLetters, onClose }: { value: string; onChange: (v: string) => void; onOk?: () => void; onLetters: () => void; onClose?: () => void }) {
  // A laptop / hardware keyboard works too while the keypad is up: any letter, digit or dash is
  // typed in, Backspace deletes, Enter = OK (closes the keypad window, e.g. shows the search
  // results), Escape closes it without anything else.
  const valueRef = useRef(value);
  valueRef.current = value;
  const cb = useRef({ onChange, onOk, onClose });
  cb.current = { onChange, onOk, onClose };
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
        cb.current.onOk?.();
      } else if (e.key === "Escape") {
        cb.current.onClose?.();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
        {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
          <button key={d} type="button" onClick={() => onChange(value + d)} style={key}>
            {d}
          </button>
        ))}
        <button type="button" onClick={() => onChange(value.slice(0, -1))} style={{ ...key, fontSize: 20 }} aria-label="Delete">
          ⌫
        </button>
        <button type="button" onClick={() => onChange(value + "0")} style={key}>
          0
        </button>
        <button type="button" onClick={() => onOk?.()} style={{ ...key, background: "var(--accent)", color: "var(--bg-deep)", border: "none", fontSize: 17 }}>
          OK
        </button>
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <button type="button" onClick={() => onChange("")} style={{ ...modeButton, flex: 1 }}>
          Clear
        </button>
        <button type="button" onClick={onLetters} style={{ ...modeButton, flex: 1 }} title="Use the device keyboard (letters)">
          ABC
        </button>
      </div>
    </div>
  );
}

const key: CSSProperties = {
  height: 68,
  borderRadius: "var(--radius-control)",
  border: "1px solid var(--border)",
  background: "var(--bg-deep)",
  color: "var(--text)",
  fontSize: 24,
  fontWeight: 600,
  cursor: "pointer",
};

const modeButton: CSSProperties = {
  height: 48,
  padding: "0 16px",
  borderRadius: "var(--radius-control)",
  border: "1px solid var(--border)",
  background: "transparent",
  color: "var(--text-2)",
  fontSize: 14,
  fontWeight: 700,
  cursor: "pointer",
};
