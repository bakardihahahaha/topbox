import { useEffect, useState } from "react";
import { onDataChange } from "../lib/liveEvents.js";

const KEY = "biosite-signoff.footer";

/** The footer line from Setup → Document, at the bottom of every screen (sign-in screen too).
 * Remembered on the device so it shows offline as well. */
export function ScreenFooter() {
  const [text, setText] = useState(() => {
    try {
      return localStorage.getItem(KEY) ?? "";
    } catch {
      return "";
    }
  });
  useEffect(() => {
    const load = () =>
      void fetch("/api/footer")
        .then((r) => (r.ok ? (r.json() as Promise<{ text: string }>) : null))
        .then((d) => {
          if (!d) return;
          setText(d.text);
          try {
            localStorage.setItem(KEY, d.text);
          } catch {
            // best-effort
          }
        })
        .catch(() => {});
    load();
    return onDataChange(load);
  }, []);
  if (!text.trim()) return null;
  return (
    <footer style={{ flex: "none", padding: "6px 16px", borderTop: "1px solid var(--border-soft)", background: "var(--bg-base)", color: "var(--text-3)", fontSize: 12, textAlign: "center", whiteSpace: "pre-wrap" }}>
      {text}
    </footer>
  );
}
