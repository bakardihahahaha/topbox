import { useRef, useState } from "react";
import { MIN_SIGNATURE_LENGTH, signatureLength } from "@biosite-signoff/shared";
import { SignaturePad, type SignaturePadHandle } from "./SignaturePad.js";
import { ghost, input, label, primary } from "../lib/ui.js";

const todayLocal = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/** "Sign and date here" for one check column — the signature and date land in that column only. */
const nowTime = () => {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

export function SignModal({ checkLabel, name, onCancel, onSave }: { checkLabel: string; name: string; onCancel: () => void; onSave: (path: string, date: string, time: string) => void }) {
  const pad = useRef<SignaturePadHandle>(null);
  const [path, setPath] = useState<string | null>(null);
  const [date, setDate] = useState(todayLocal());
  const [time, setTime] = useState(nowTime());
  // An empty box, a dot or a tiny flick isn't a signature (the server refuses it too).
  const signed = Boolean(path) && signatureLength(path!) >= MIN_SIGNATURE_LENGTH;

  return (
    <div role="dialog" aria-modal="true" onClick={onCancel} style={{ position: "fixed", inset: 0, background: "rgba(10,12,14,.55)", zIndex: 9000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "min(96vw, 900px)", maxHeight: "94vh", overflowY: "auto", background: "var(--bg-base)", border: "1px solid var(--border-soft)", borderRadius: "var(--radius-card)", padding: 18, display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ fontSize: 15, fontWeight: 700 }}>Sign {checkLabel}</div>
        <div style={{ fontSize: 13, color: "var(--text-3)" }}>
          Signing as <strong style={{ color: "var(--text)" }}>{name}</strong>. Once signed, this check's marks are locked.
        </div>
        <SignaturePad ref={pad} onChange={setPath} />
        {path && !signed && <div style={{ fontSize: 12.5, color: "var(--warn)" }}>That's too short to be a signature — please sign properly.</div>}
        <div style={{ display: "grid", gridTemplateColumns: "3fr 2fr", gap: 8 }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span className="mono" style={label}>
              Date
            </span>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={input} />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span className="mono" style={label}>
              Time
            </span>
            <input type="time" value={time} onChange={(e) => setTime(e.target.value)} style={input} />
          </label>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
          <button style={ghost} onClick={() => pad.current?.clear()}>
            Clear
          </button>
          <div style={{ display: "flex", gap: 8 }}>
            <button style={ghost} onClick={onCancel}>
              Cancel
            </button>
            <button style={{ ...primary, height: 38, opacity: signed && date ? 1 : 0.5 }} disabled={!signed || !date} onClick={() => path && signed && onSave(path, date, time)}>
              Sign
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
