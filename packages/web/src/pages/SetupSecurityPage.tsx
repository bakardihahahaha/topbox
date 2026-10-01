import { useEffect, useState } from "react";
import { getSecurity, setSecurity, type SecuritySettings } from "../lib/api.js";
import { SetupSubNav } from "../components/SetupSubNav.js";
import { card, errorBox, errorMessage, h1, hint, infoBox, input, label, page, primary } from "../lib/ui.js";

export function SetupSecurityPage() {
  const [s, setS] = useState<SecuritySettings | null>(null);
  const [idle, setIdle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    getSecurity().then(
      (v) => {
        setS(v);
        setIdle(String(v.idleTimeoutMinutes));
      },
      (err) => setError(errorMessage(err)),
    );
  }, []);

  async function save(patch: Partial<SecuritySettings>) {
    setError(null);
    setSaved(false);
    try {
      setS(await setSecurity(patch));
      setSaved(true);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <div style={page}>
      <h1 style={h1}>Setup</h1>
      <SetupSubNav />
      {error && <div style={errorBox}>{error}</div>}
      {saved && <div style={infoBox}>Saved.</div>}
      {s && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={card}>
            <label style={{ display: "flex", alignItems: "flex-start", gap: 10, cursor: "pointer" }}>
              <input type="checkbox" checked={s.singleIp} onChange={(e) => void save({ singleIp: e.target.checked })} style={{ width: 24, height: 24, accentColor: "var(--accent)", marginTop: 2 }} />
              <span>
                <div style={{ fontWeight: 700 }}>One network (IP) per account</div>
                <div style={{ ...hint, margin: "4px 0 0" }}>
                  A session only works from the IP it signed in from, and signing in from a second IP is refused while the first session is still active. A token copied to another
                  network stops working immediately. Devices behind the same router share one IP, so several devices on site still work. When a phone switches from Wi-Fi to mobile data it
                  simply has to sign in again.
                </div>
              </span>
            </label>
          </div>
          <div style={card}>
            <label style={{ display: "flex", alignItems: "flex-start", gap: 10, cursor: "pointer" }}>
              <input type="checkbox" checked={s.cardNeedsPin} onChange={(e) => void save({ cardNeedsPin: e.target.checked })} style={{ width: 24, height: 24, accentColor: "var(--accent)", marginTop: 2 }} />
              <span>
                <div style={{ fontWeight: 700 }}>RFID card + PIN</div>
                <div style={{ ...hint, margin: "4px 0 0" }}>
                  Off: tapping a card on the reader signs that person straight in. On: the card only picks the person — they still type their PIN (safer if a card is lost or copied).
                  Cards are assigned in Setup → Users.
                </div>
              </span>
            </label>
          </div>
          <div style={card}>
            <div style={{ fontWeight: 700, marginBottom: 4 }}>Deleting sign-offs</div>
            <p style={{ ...hint, margin: 0 }}>
              Operators and admins can delete a sign-off (operators only a TopBox&apos;s current visit). It isn&apos;t gone: it moves to the <b>Deleted</b> tab, where an admin can restore it or
              delete it forever. Fixed rules too: only an admin can change a serial number (apart from the refurbished R), the type, remove a signature, or change a completed sign-off.
            </p>
          </div>
          <div style={card}>
            <div style={{ fontWeight: 700, marginBottom: 4 }}>Auto sign-out when idle</div>
            <p style={{ ...hint, margin: "0 0 10px" }}>Minutes without any activity before a session ends (0 = never). Keeps the one-IP rule from locking someone out for long after they walk away from a device.</p>
            <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
              <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <span className="mono" style={label}>
                  Minutes
                </span>
                <input value={idle} onChange={(e) => setIdle(e.target.value)} inputMode="numeric" style={{ ...input, width: 110 }} />
              </label>
              <button style={primary} onClick={() => void save({ idleTimeoutMinutes: Number(idle) })}>
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
