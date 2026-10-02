import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";

// The app's own on-screen keyboard for text fields (notes, part notes, names…). Windows in kiosk
// mode doesn't bring up its touch keyboard (and many kiosk touch screens act as a mouse, so Windows
// never even knows it was a finger), so — like the serial-number keypad — the app brings its own.
// On / Off per device (the ⌨ button in the top bar and on the sign-in screen); starts On on
// Windows, Off elsewhere (iPad / phones open their own keyboard anyway).

type Mode = "on" | "off";
const KEY = "biosite-signoff.osk";

function initialMode(): Mode {
  try {
    const v = localStorage.getItem(KEY);
    if (v === "on" || v === "off") return v;
  } catch {
    // no storage — fall through
  }
  return /Windows/i.test(navigator.userAgent) ? "on" : "off";
}

let mode: Mode = typeof window === "undefined" ? "off" : initialMode();
const listeners = new Set<() => void>();

export function toggleOnScreenKeyboard(): void {
  mode = mode === "on" ? "off" : "on";
  try {
    localStorage.setItem(KEY, mode);
  } catch {
    // best-effort
  }
  listeners.forEach((l) => l());
}

export function useOnScreenKeyboardLabel(): string {
  const m = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => mode,
  );
  return m === "on" ? "⌨ On" : "⌨ Off";
}

type Field = HTMLInputElement | HTMLTextAreaElement;

const TEXT_TYPES = ["text", "search", "email", "url", "tel", "password", "number", ""];

function isTextField(el: EventTarget | null): el is Field {
  if (el instanceof HTMLTextAreaElement) return !el.readOnly && !el.disabled && !el.hasAttribute("data-no-osk");
  if (!(el instanceof HTMLInputElement)) return false;
  if (el.readOnly || el.disabled || el.hasAttribute("data-no-osk")) return false;
  return TEXT_TYPES.includes(el.type);
}

/** Types into the field the way a real key press would, so React's onChange sees it. */
function insert(el: Field, text: string) {
  const value = el.value;
  let start = value.length;
  let end = value.length;
  try {
    start = el.selectionStart ?? value.length;
    end = el.selectionEnd ?? value.length;
  } catch {
    // number / email inputs have no selection — append
  }
  if (el.maxLength > 0 && value.length - (end - start) + text.length > el.maxLength) return;
  setValue(el, value.slice(0, start) + text + value.slice(end), start + text.length);
}

function backspace(el: Field) {
  const value = el.value;
  let start = value.length;
  let end = value.length;
  try {
    start = el.selectionStart ?? value.length;
    end = el.selectionEnd ?? value.length;
  } catch {
    // append mode
  }
  if (start === end && start === 0) return;
  const from = start === end ? start - 1 : start;
  setValue(el, value.slice(0, from) + value.slice(end), from);
}

function setValue(el: Field, next: string, caret: number) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, next);
  el.dispatchEvent(new Event("input", { bubbles: true }));
  try {
    el.setSelectionRange(caret, caret);
  } catch {
    // no selection on this input type
  }
}

const LETTERS = ["qwertyuiop", "asdfghjkl", "zxcvbnm"];
const POLISH = "ąćęłńóśźż";
const SYMBOLS = ["1234567890", "-/:;()&@\"", "#%+=*'?!_"];

export function OnScreenKeyboardHost() {
  useOnScreenKeyboardLabel(); // re-render on On / Off
  const [field, setField] = useState<Field | null>(null);
  const [shift, setShift] = useState(false);
  const [layer, setLayer] = useState<"abc" | "123" | "pl">("abc");
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onFocus = (e: FocusEvent) => {
      if (mode !== "on" || !isTextField(e.target)) return;
      const el = e.target;
      // Keep the device's own keyboard (Windows touch keyboard, tablets) out of the way.
      if (el.inputMode !== "none") {
        el.dataset.oskInputMode = el.inputMode || "-";
        el.inputMode = "none";
      }
      setField(el);
    };
    const onBlur = (e: FocusEvent) => {
      // Moving to another text field: onFocus takes over. Anywhere else: put the keyboard away.
      setTimeout(() => {
        if (!isTextField(document.activeElement)) setField(null);
      }, 0);
      const el = e.target;
      if (el instanceof HTMLElement && el.dataset.oskInputMode) {
        const prev = el.dataset.oskInputMode;
        delete el.dataset.oskInputMode;
        (el as Field).inputMode = prev === "-" ? "" : prev;
      }
    };
    document.addEventListener("focusin", onFocus);
    document.addEventListener("focusout", onBlur);
    return () => {
      document.removeEventListener("focusin", onFocus);
      document.removeEventListener("focusout", onBlur);
    };
  }, []);

  // Make room under the page so the keyboard never covers the field being typed in.
  useEffect(() => {
    if (!field) return;
    const h = panel.current?.offsetHeight ?? 300;
    document.body.style.paddingBottom = `${h}px`;
    const root = document.getElementById("root");
    if (root) root.style.paddingBottom = `${h}px`;
    const t = setTimeout(() => field.scrollIntoView({ block: "center", behavior: "smooth" }), 50);
    return () => {
      clearTimeout(t);
      document.body.style.paddingBottom = "";
      if (root) root.style.paddingBottom = "";
    };
  }, [field]);

  if (!field || mode !== "on") return null;

  const type = (ch: string) => {
    insert(field, shift ? ch.toUpperCase() : ch);
    if (shift) setShift(false);
  };
  const enter = () => {
    if (field instanceof HTMLTextAreaElement) return insert(field, "\n");
    if (field.form) field.form.requestSubmit();
    else field.blur();
  };
  // Keep the focus (and the caret) in the field while keys are pressed.
  const hold = (e: React.PointerEvent | React.MouseEvent) => e.preventDefault();
  const rows = layer === "123" ? SYMBOLS : layer === "pl" ? [POLISH, ...LETTERS.slice(1)] : LETTERS;

  return (
    <div
      ref={panel}
      role="group"
      aria-label="On-screen keyboard"
      onPointerDown={hold}
      onMouseDown={hold}
      style={{ position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 9500, background: "var(--bg-bezel)", borderTop: "1px solid var(--border)", padding: "8px 8px 10px", userSelect: "none", touchAction: "manipulation" }}
    >
      <div style={{ maxWidth: 980, margin: "0 auto", display: "flex", flexDirection: "column", gap: 6 }}>
        {rows.map((row, i) => (
          <div key={i} style={{ display: "flex", gap: 6, justifyContent: "center" }}>
            {i === 2 && layer !== "123" && (
              <button type="button" onClick={() => setShift((s) => !s)} style={{ ...key, ...wide, ...(shift ? on : {}) }} aria-label="Shift">
                ⇧
              </button>
            )}
            {[...row].map((ch) => (
              <button key={ch} type="button" onClick={() => type(ch)} style={key}>
                {shift ? ch.toUpperCase() : ch}
              </button>
            ))}
            {i === 2 && (
              <button type="button" onClick={() => backspace(field)} style={{ ...key, ...wide }} aria-label="Delete">
                ⌫
              </button>
            )}
          </div>
        ))}
        <div style={{ display: "flex", gap: 6, justifyContent: "center" }}>
          <button type="button" onClick={() => setLayer(layer === "123" ? "abc" : "123")} style={{ ...key, ...wide }}>
            {layer === "123" ? "ABC" : "123"}
          </button>
          <button type="button" onClick={() => setLayer(layer === "pl" ? "abc" : "pl")} style={{ ...key, ...wide, ...(layer === "pl" ? on : {}) }} title="Polish letters">
            ĄĘ
          </button>
          <button type="button" onClick={() => type(",")} style={key}>
            ,
          </button>
          <button type="button" onClick={() => insert(field, " ")} style={{ ...key, flex: 5, maxWidth: 420 }} aria-label="Space">
            space
          </button>
          <button type="button" onClick={() => type(".")} style={key}>
            .
          </button>
          <button type="button" onClick={enter} style={{ ...key, ...wide }} aria-label="Enter">
            ↵
          </button>
          <button type="button" onClick={() => field.blur()} style={{ ...key, ...wide, background: "var(--accent)", color: "var(--bg-deep)", border: "none" }}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

const key: CSSProperties = {
  flex: 1,
  maxWidth: 76,
  height: 52,
  borderRadius: "var(--radius-control)",
  border: "1px solid var(--border)",
  background: "var(--bg-base)",
  color: "var(--text)",
  fontSize: 19,
  fontWeight: 600,
  cursor: "pointer",
  padding: 0,
};
const wide: CSSProperties = { flex: 1.5, maxWidth: 110, fontSize: 16 };
const on: CSSProperties = { borderColor: "var(--accent)", color: "var(--accent)", background: "var(--accent-wash)" };
