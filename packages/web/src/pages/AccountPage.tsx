import { useState, type FormEvent } from "react";
import { changeOwnPassword } from "../lib/api.js";
import { useMe } from "../lib/meContext.js";
import { SetupSubNav } from "../components/SetupSubNav.js";
import { card, errorBox, errorMessage, h1, infoBox, input, label, page, primary } from "../lib/ui.js";

export function AccountPage() {
  const me = useMe();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    try {
      await changeOwnPassword(current, next);
      setCurrent("");
      setNext("");
      setMsg({ ok: true, text: "Password changed." });
    } catch (err) {
      setMsg({ ok: false, text: errorMessage(err) });
    }
  }

  return (
    <div style={page}>
      <h1 style={h1}>Setup</h1>
      <SetupSubNav />
      <div style={{ ...card, maxWidth: 420 }}>
        <div style={{ fontWeight: 700 }}>{me.name}</div>
        <div className="mono" style={{ fontSize: 12, color: "var(--text-3)", marginBottom: 14 }}>
          @{me.username} · {me.role}
        </div>
        {msg && <div style={msg.ok ? infoBox : errorBox}>{msg.text}</div>}
        <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span className="mono" style={label}>
              Current password
            </span>
            <input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" style={input} />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span className="mono" style={label}>
              New password (min. 8)
            </span>
            <input type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" style={input} />
          </label>
          <button style={primary} disabled={!current || next.length < 8}>
            Change password
          </button>
        </form>
      </div>
    </div>
  );
}
