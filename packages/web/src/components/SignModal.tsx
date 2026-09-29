import { useRef, useState } from "react";
import { SignaturePad, type SignaturePadHandle } from "./SignaturePad.js";
import { ghost, input, label, primary } from "../lib/ui.js";

const todayLocal = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/** "Sign and date here" for one check column — the signature and date land in that column only. */
export function SignModal({ checkLabel, name, onCancel, onSave }: { checkLabel: string; name: string; onCancel: () => void; onSave: (path: string, date: string) => void }) {
  const pad = useRef<SignaturePadHandle>(null);
  const [path, setPath] = useState<string | null>(null);
  const [date, setDate] = useState(todayLocal());

  return (
    <div role="dialog" aria-modal="true" onClick={onCancel} style={{ position: "fixed", inset: 0, background: "rgba(10,12,14,.55)", zIndex: 9000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "min(94vw, 460px)", background: "var(--bg-base)", border: "1px solid var(--border-soft)", borderRadius: "var(--radius-card)", padding: 18, display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ fontSize: 15, fontWeight: 700 }}>Sign {checkLabel}</div>
        <div style={{ fontSize: 13, color: "var(--text-3)" }}>
          Signing as <strong style={{ color: "var(--text)" }}>{name}</strong>. Once signed, this check's marks are locked.
        </div>
        <SignaturePad ref={pad} onChange={setPath} />
        <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span className="mono" style={label}>
            Date
          </span>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={input} />
        </label>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
          <button style={ghost} onClick={() => pad.current?.clear()}>
            Clear
          </button>
          <div style={{ display: "flex", gap: 8 }}>
            <button style={ghost} onClick={onCancel}>
              Cancel
            </button>
            <button style={{ ...primary, height: 38, opacity: path && date ? 1 : 0.5 }} disabled={!path || !date} onClick={() => path && onSave(path, date)}>
              Sign
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
