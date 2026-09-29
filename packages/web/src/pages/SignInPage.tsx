import { useState, type CSSProperties, type FormEvent } from "react";
import { useTheme } from "../theme/ThemeContext.js";
import { login } from "../lib/client.js";
import { APP_VERSION, clearCacheAndCookies } from "../lib/clearCache.js";
import { confirmDialog } from "../lib/confirmDialog.js";

// Decom's sign-in screen, unchanged apart from the name and the policy callout — same card, same
// "clear cache & cookies" escape hatch and build number under the form.

interface SignInPageProps {
  onSignedIn: () => void;
  /** Shown as an informational callout above the form — right now only ever "signed out after
   * being idle" (see idleLogout.ts), so a stale-out reads as an explained transition instead of a
   * confusing jump back to this screen. */
  message?: string;
}

export function SignInPage({ onSignedIn, message }: SignInPageProps) {
  const { themeLabel, cycleTheme } = useTheme();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [clearing, setClearing] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    const result = await login(username, password);
    setSubmitting(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onSignedIn();
  }

  async function handleClearCache() {
    if (!(await confirmDialog("This will clear the app's cache, cookies, and local data, then reload it. Continue?", { confirmLabel: "Clear & reload" }))) return;
    setClearing(true);
    await clearCacheAndCookies();
  }

  return (
    <div
      style={{
        height: "100%",
        overflowY: "auto",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--bg-deep)",
        padding: 16,
      }}
    >
      <div
        style={{
          width: 420,
          maxWidth: "100%",
          background: "var(--bg-deep)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-card)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            padding: "20px 24px 18px",
            borderBottom: "1px solid var(--border)",
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: 12,
          }}
        >
          <div style={{ fontSize: 26, fontWeight: 700 }}>Biosite Sign-off</div>
          <button
            type="button"
            onClick={cycleTheme}
            className="mono"
            style={{
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: ".08em",
              padding: "5px 9px",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-control)",
              color: "var(--text-2)",
              background: "transparent",
              cursor: "pointer",
            }}
          >
            {themeLabel}
          </button>
        </div>

        <form onSubmit={handleSubmit} style={{ padding: 20, display: "flex", flexDirection: "column", gap: 14 }}>
          {message && (
            <div
              style={{
                background: "var(--accent-wash)",
                borderLeft: "3px solid var(--accent)",
                borderRadius: "var(--radius-callout)",
                padding: "10px 12px",
                fontSize: 13,
                color: "var(--accent-wash-text)",
              }}
            >
              {message}
            </div>
          )}
          <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span className="mono" style={labelStyle}>
              Username
            </span>
            <input value={username} onChange={(e) => setUsername(e.target.value)} className="mono" style={inputStyle} autoComplete="username" />
          </label>

          <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span className="mono" style={labelStyle}>
              Password
            </span>
            <div style={{ position: "relative" }}>
              <input
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                type={showPassword ? "text" : "password"}
                className="mono"
                style={{ ...inputStyle, paddingRight: 44 }}
                autoComplete="current-password"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? "Hide password" : "Show password"}
                className="mono"
                style={{
                  position: "absolute",
                  right: 4,
                  top: "50%",
                  transform: "translateY(-50%)",
                  height: 34,
                  width: 36,
                  border: "none",
                  background: "transparent",
                  color: "var(--text-3)",
                  fontSize: 10,
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                {showPassword ? "HIDE" : "SHOW"}
              </button>
            </div>
          </label>

          <div
            style={{
              background: "var(--accent-wash)",
              borderLeft: "3px solid var(--accent)",
              borderRadius: "var(--radius-callout)",
              padding: "10px 12px",
              fontSize: 13,
              color: "var(--accent-wash-text)",
            }}
          >
            3 failed attempts locks the account. One account can only be signed in from one network (IP) at a time.
          </div>

          {error && (
            <div
              style={{
                background: "var(--danger-wash)",
                borderLeft: "3px solid var(--danger)",
                borderRadius: "var(--radius-callout)",
                padding: "8px 10px",
                fontSize: 13,
                color: "var(--danger-text)",
              }}
            >
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            style={{
              height: 50,
              borderRadius: "var(--radius-control)",
              border: "none",
              background: "var(--accent)",
              color: "var(--bg-deep)",
              fontWeight: 700,
              fontSize: 15,
              cursor: submitting ? "default" : "pointer",
              opacity: submitting ? 0.7 : 1,
            }}
          >
            {submitting ? "…" : "Sign in"}
          </button>

          <button
            type="button"
            onClick={handleClearCache}
            disabled={clearing}
            className="mono"
            style={{
              height: 40,
              borderRadius: "var(--radius-control)",
              border: "1px solid var(--border)",
              background: "transparent",
              color: "var(--text-2)",
              fontWeight: 700,
              fontSize: 12,
              cursor: clearing ? "default" : "pointer",
              opacity: clearing ? 0.6 : 1,
            }}
          >
            {clearing ? "Clearing…" : "Clear cache & cookies"}
          </button>

          <div className="mono" style={{ fontSize: 11, color: "var(--text-4)", textAlign: "center" }}>
            Build: {APP_VERSION}
          </div>
        </form>
      </div>
    </div>
  );
}

const labelStyle: CSSProperties = { fontSize: 9.5, fontWeight: 700, letterSpacing: ".09em", color: "var(--text-3)" };

const inputStyle: CSSProperties = {
  width: "100%",
  height: 46,
  borderRadius: "var(--radius-control)",
  background: "var(--bg-deep)",
  border: "1px solid var(--border)",
  padding: "0 12px",
  fontSize: 15,
  color: "var(--text)",
};
