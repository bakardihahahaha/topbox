import { useState, type FormEvent } from "react";
import { changeOwnPin } from "../lib/api.js";
import { useMe } from "../lib/meContext.js";
import { SetupSubNav } from "../components/SetupSubNav.js";
import { card, errorBox, errorMessage, h1, infoBox, input, label, page, primary } from "../lib/ui.js";

export function AccountPage() {
  const me = useMe();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const valid = /^\d{4,8}$/.test(next);

  async function submit(e: FormEvent) {
    e.preventDefault();
    try {
      await changeOwnPin(current, next);
      setCurrent("");
      setNext("");
      setMsg({ ok: true, text: "PIN changed." });
    } catch (err) {
      setMsg({ ok: false, text: errorMessage(err) });
    }
  }

  const digits = (v: string) => v.replace(/\D/g, "").slice(0, 8);

  return (
    <div style={page}>
      <h1 style={h1}>Setup</h1>
      <SetupSubNav />
      <div style={{ ...card, maxWidth: 420 }}>
        <div style={{ fontWeight: 700 }}>{me.name}</div>
        <div className="mono" style={{ fontSize: 12, color: "var(--text-3)", marginBottom: 14 }}>
          {me.role}
        </div>
        {msg && <div style={msg.ok ? infoBox : errorBox}>{msg.text}</div>}
        <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span className="mono" style={label}>
              Current PIN
            </span>
            <input type="password" inputMode="numeric" value={current} onChange={(e) => setCurrent(digits(e.target.value))} className="mono" style={input} />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span className="mono" style={label}>
              New PIN (4–8 digits)
            </span>
            <input type="password" inputMode="numeric" value={next} onChange={(e) => setNext(digits(e.target.value))} className="mono" style={input} />
          </label>
          <button style={{ ...primary, opacity: current && valid ? 1 : 0.5 }} disabled={!current || !valid}>
            Change PIN
          </button>
        </form>
      </div>
    </div>
  );
}
