import { useEffect, useState } from "react";
import { getOperatingHours, getSecurity, setOperatingHours, setSecurity, type OperatingHours, type SecuritySettings } from "../lib/api.js";
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
          <OperatingHoursCard />
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

const DAYS = [
  { d: 1, label: "Mon" },
  { d: 2, label: "Tue" },
  { d: 3, label: "Wed" },
  { d: 4, label: "Thu" },
  { d: 5, label: "Fri" },
  { d: 6, label: "Sat" },
  { d: 0, label: "Sun" },
];

function timeZones(): string[] {
  try {
    return (Intl as unknown as { supportedValuesOf(k: string): string[] }).supportedValuesOf("timeZone");
  } catch {
    return ["Europe/London", "Europe/Warsaw", "Europe/Dublin", "UTC"];
  }
}

/** Operating hours: outside them only admins get in (through "#admin" on the sign-in screen). */
function OperatingHoursCard() {
  const [h, setH] = useState<OperatingHours | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    getOperatingHours().then(setH, (err) => setError(errorMessage(err)));
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);
  if (!h) return error ? <div style={errorBox}>{error}</div> : null;
  const zones = timeZones();
  const local = (() => {
    try {
      return new Intl.DateTimeFormat("en-GB", { timeZone: h.timeZone, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(now);
    } catch {
      return "—";
    }
  })();
  const set = (patch: Partial<OperatingHours>) => {
    setSaved(false);
    setH({ ...h, ...patch });
  };
  async function save() {
    if (!h) return;
    setError(null);
    try {
      setH(await setOperatingHours(h));
      setSaved(true);
    } catch (err) {
      setError(errorMessage(err));
    }
  }
  return (
    <div style={card}>
      <label style={{ display: "flex", alignItems: "flex-start", gap: 10, cursor: "pointer" }}>
        <input type="checkbox" checked={h.enabled} onChange={(e) => set({ enabled: e.target.checked })} style={{ width: 24, height: 24, accentColor: "var(--accent)", marginTop: 2 }} />
        <span>
          <div style={{ fontWeight: 700 }}>Operating hours</div>
          <div style={{ ...hint, margin: "4px 0 0" }}>
            Outside these hours the service is closed: no names on the sign-in screen, everyone but admins is signed out, and every request from a non-admin — app, script or bot — gets
            only &quot;service closed&quot;. Admins get in after hours by adding <b className="mono">#admin</b> to the address (e.g. topbox.duckdns.org/#admin) and typing their name and PIN.
          </div>
        </span>
      </label>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10, marginTop: 12, opacity: h.enabled ? 1 : 0.55 }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 6, gridColumn: "span 2" }}>
          <span className="mono" style={label}>
            Time zone
          </span>
          <select value={h.timeZone} onChange={(e) => set({ timeZone: e.target.value })} style={{ ...input, height: 44 }}>
            {(zones.includes(h.timeZone) ? zones : [h.timeZone, ...zones]).map((z) => (
              <option key={z} value={z}>
                {z.replace(/_/g, " ")}
              </option>
            ))}
          </select>
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span className="mono" style={label}>
            Open from
          </span>
          <input type="time" value={h.from} onChange={(e) => set({ from: e.target.value })} style={{ ...input, height: 44 }} />
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span className="mono" style={label}>
            Closes at
          </span>
          <input type="time" value={h.to} onChange={(e) => set({ to: e.target.value })} style={{ ...input, height: 44 }} />
        </label>
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10, opacity: h.enabled ? 1 : 0.55 }}>
        {DAYS.map(({ d, label: l }) => {
          const on = h.days.includes(d);
          return (
            <button
              key={d}
              type="button"
              onClick={() => set({ days: on ? h.days.filter((x) => x !== d) : [...h.days, d] })}
              aria-pressed={on}
              style={{ height: 44, minWidth: 56, borderRadius: "var(--radius-control)", border: `1px solid ${on ? "var(--accent)" : "var(--border)"}`, background: on ? "var(--accent-wash)" : "transparent", color: on ? "var(--accent)" : "var(--text-3)", fontWeight: 700, cursor: "pointer" }}
            >
              {l}
            </button>
          );
        })}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 12, flexWrap: "wrap" }}>
        <button style={primary} onClick={() => void save()}>
          Save hours
        </button>
        <span className="mono" style={{ fontSize: 12.5, color: "var(--text-3)" }}>
          Now in {h.timeZone.split("/").pop()?.replace(/_/g, " ")}: {local}
        </span>
        {saved && <span style={{ fontSize: 13, color: "var(--accent)" }}>Saved.</span>}
      </div>
      {error && <div style={{ ...errorBox, marginTop: 10 }}>{error}</div>}
    </div>
  );
}
