import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { LoginUser } from "@biosite-signoff/shared";
import { useTheme } from "../theme/ThemeContext.js";
import { fetchLoginUsers, login } from "../lib/client.js";
import { APP_VERSION, clearCacheAndCookies } from "../lib/clearCache.js";
import { confirmDialog } from "../lib/confirmDialog.js";

// Tap your name, type your PIN — the whole sign-in. Every active user is a tile on the first
// screen so nobody types a username. Same card/colour language as decom's sign-in screen.

interface SignInPageProps {
  onSignedIn: () => void;
  message?: string;
}

function useNow(active: boolean): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  return now;
}

const countdown = (until: string, now: number) => {
  const s = Math.max(0, Math.ceil((Date.parse(until) - now) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");

export function SignInPage({ onSignedIn, message }: SignInPageProps) {
  const { themeLabel, cycleTheme } = useTheme();
  const [users, setUsers] = useState<LoginUser[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selected, setSelected] = useState<LoginUser | null>(null);
  const [filter, setFilter] = useState("");
  const [clearing, setClearing] = useState(false);
  const anyLocked = Boolean(users?.some((u) => u.lockedUntil));
  const now = useNow(anyLocked || Boolean(selected?.lockedUntil));

  async function load() {
    try {
      setUsers(await fetchLoginUsers());
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    }
  }

  useEffect(() => {
    void load();
  }, []);

  // A lock that ran out: refresh so the tile unlocks by itself.
  useEffect(() => {
    if (users?.some((u) => u.lockedUntil && Date.parse(u.lockedUntil) <= now)) void load();
  }, [now, users]);

  const visible = (users ?? []).filter((u) => u.name.toLowerCase().includes(filter.trim().toLowerCase()));

  return (
    <div style={{ height: "100%", overflowY: "auto", background: "var(--bg-deep)", padding: 16 }}>
      <div style={{ maxWidth: 900, margin: "0 auto", display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, paddingTop: 8 }}>
          <div style={{ fontSize: 24, fontWeight: 700 }}>Biosite Sign-off</div>
          <button type="button" onClick={cycleTheme} className="mono" style={smallButton}>
            {themeLabel}
          </button>
        </div>

        {message && <div style={infoBox}>{message}</div>}
        {loadError && (
          <div style={errorBox}>
            {loadError}{" "}
            <button onClick={() => void load()} style={{ ...smallButton, marginLeft: 8 }}>
              Retry
            </button>
          </div>
        )}

        <div style={{ fontSize: 13, color: "var(--text-3)" }}>Tap your name, then enter your PIN.</div>
        {users && users.length > 12 && (
          <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Find your name…" style={{ ...input, height: 44 }} />
        )}

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 10 }}>
          {users === null && !loadError && <div style={{ color: "var(--text-3)", fontSize: 13 }}>Loading…</div>}
          {visible.map((u) => {
            const locked = u.lockedUntil && Date.parse(u.lockedUntil) > now;
            return (
              <button
                key={u.id}
                onClick={() => setSelected(u)}
                style={{
                  minHeight: 92,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 8,
                  padding: 10,
                  background: "var(--bg-base)",
                  border: "1px solid var(--border-soft)",
                  borderRadius: "var(--radius-card)",
                  cursor: "pointer",
                  opacity: locked ? 0.55 : 1,
                }}
              >
                <span
                  className="mono"
                  style={{ width: 40, height: 40, borderRadius: "50%", background: "var(--accent-chip)", color: "var(--accent)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 14 }}
                >
                  {initials(u.name)}
                </span>
                <span style={{ fontWeight: 600, fontSize: 14.5, textAlign: "center", lineHeight: 1.2 }}>{u.name}</span>
                {locked && (
                  <span className="mono" style={{ fontSize: 11, color: "var(--warn)" }}>
                    locked {countdown(u.lockedUntil!, now)}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginTop: 24, flexWrap: "wrap" }}>
          <button
            type="button"
            disabled={clearing}
            className="mono"
            style={smallButton}
            onClick={async () => {
              if (!(await confirmDialog("This will clear the app's cache, cookies, and local data, then reload it. Continue?", { confirmLabel: "Clear & reload" }))) return;
              setClearing(true);
              await clearCacheAndCookies();
            }}
          >
            {clearing ? "Clearing…" : "Clear cache & cookies"}
          </button>
          <span className="mono" style={{ fontSize: 11, color: "var(--text-4)" }}>
            Build: {APP_VERSION}
          </span>
        </div>
      </div>

      {selected && (
        <PinPanel
          user={selected}
          now={now}
          onClose={() => {
            setSelected(null);
            void load();
          }}
          onLocked={(retryAt) => {
            setSelected((s) => (s ? { ...s, lockedUntil: retryAt } : s));
            void load();
          }}
          onSignedIn={onSignedIn}
        />
      )}
    </div>
  );
}

function PinPanel({ user, now, onClose, onLocked, onSignedIn }: { user: LoginUser; now: number; onClose: () => void; onLocked: (retryAt: string) => void; onSignedIn: () => void }) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const locked = user.lockedUntil && Date.parse(user.lockedUntil) > now;

  useEffect(() => inputRef.current?.focus(), []);

  async function submit() {
    if (busy || pin.length < 4 || locked) return;
    setBusy(true);
    setError(null);
    const result = await login(user.id, pin);
    setBusy(false);
    setPin("");
    if (result.ok) return onSignedIn();
    if (result.code === "INVALID_PIN" && result.attemptsLeft !== undefined) {
      setError(`Wrong PIN — ${result.attemptsLeft} ${result.attemptsLeft === 1 ? "try" : "tries"} left before a 5-minute lock.`);
    } else {
      setError(result.error);
    }
    if ((result.code === "TEMP_LOCKED" || result.code === "IP_BLOCKED") && result.retryAt) onLocked(result.retryAt);
    inputRef.current?.focus();
  }

  const press = (d: string) => {
    setError(null);
    setPin((p) => (p.length < 8 ? p + d : p));
    inputRef.current?.focus();
  };

  return (
    <div role="dialog" aria-modal="true" onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(10,12,14,.6)", zIndex: 9000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ width: "min(94vw, 340px)", background: "var(--bg-base)", border: "1px solid var(--border-soft)", borderRadius: "var(--radius-card)", padding: 18, display: "flex", flexDirection: "column", gap: 14 }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontSize: 17, fontWeight: 700 }}>{user.name}</div>
          <button onClick={onClose} aria-label="Back" style={{ ...smallButton, padding: "4px 10px" }}>
            ✕
          </button>
        </div>

        {/* Real input underneath (hardware keyboards, password managers); the keypad drives it. */}
        <input
          ref={inputRef}
          value={pin}
          onChange={(e) => {
            setError(null);
            setPin(e.target.value.replace(/\D/g, "").slice(0, 8));
          }}
          onKeyDown={(e) => e.key === "Enter" && void submit()}
          type="password"
          inputMode="numeric"
          autoComplete="current-password"
          aria-label="PIN"
          disabled={Boolean(locked)}
          className="mono"
          style={{ ...input, height: 52, fontSize: 26, letterSpacing: ".4em", textAlign: "center" }}
        />

        {locked ? (
          <div style={errorBox}>Locked after 3 wrong PINs — try again in {countdown(user.lockedUntil!, now)}.</div>
        ) : (
          error && <div style={errorBox}>{error}</div>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
          {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
            <button key={d} onClick={() => press(d)} disabled={busy || Boolean(locked)} style={key}>
              {d}
            </button>
          ))}
          <button onClick={() => setPin((p) => p.slice(0, -1))} disabled={busy || Boolean(locked)} style={{ ...key, fontSize: 18 }} aria-label="Delete">
            ⌫
          </button>
          <button onClick={() => press("0")} disabled={busy || Boolean(locked)} style={key}>
            0
          </button>
          <button
            onClick={() => void submit()}
            disabled={busy || pin.length < 4 || Boolean(locked)}
            style={{ ...key, background: "var(--accent)", color: "var(--bg-deep)", border: "none", fontSize: 16, opacity: busy || pin.length < 4 || locked ? 0.5 : 1 }}
          >
            {busy ? "…" : "OK"}
          </button>
        </div>
      </div>
    </div>
  );
}

const smallButton: CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: ".06em",
  padding: "6px 10px",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-control)",
  color: "var(--text-2)",
  background: "transparent",
  cursor: "pointer",
};

const key: CSSProperties = {
  height: 58,
  borderRadius: "var(--radius-control)",
  border: "1px solid var(--border)",
  background: "var(--bg-deep)",
  color: "var(--text)",
  fontSize: 22,
  fontWeight: 600,
  cursor: "pointer",
};

const input: CSSProperties = {
  width: "100%",
  borderRadius: "var(--radius-control)",
  background: "var(--bg-deep)",
  border: "1px solid var(--border)",
  padding: "0 12px",
  fontSize: 15,
  color: "var(--text)",
};

const infoBox: CSSProperties = {
  background: "var(--accent-wash)",
  borderLeft: "3px solid var(--accent)",
  borderRadius: "var(--radius-callout)",
  padding: "10px 12px",
  fontSize: 13,
  color: "var(--accent-wash-text)",
};

const errorBox: CSSProperties = {
  background: "var(--danger-wash)",
  borderLeft: "3px solid var(--danger)",
  borderRadius: "var(--radius-callout)",
  padding: "8px 10px",
  fontSize: 13,
  color: "var(--danger-text)",
};
