import type { CSSProperties } from "react";

// The handful of inline-style shapes every decom screen repeats (cards, fields, buttons), pulled
// into one place here so the pages stay readable. Values are decom's, token for token.

export const page: CSSProperties = { padding: 16, paddingBottom: 64, maxWidth: 980, margin: "0 auto" };
export const h1: CSSProperties = { fontSize: 18, fontWeight: 700, margin: "0 0 4px" };
export const hint: CSSProperties = { fontSize: 13, color: "var(--text-3)", margin: "0 0 16px", lineHeight: 1.45 };
export const card: CSSProperties = { background: "var(--bg-base)", border: "1px solid var(--border-soft)", borderRadius: "var(--radius-card)", padding: 14 };
export const label: CSSProperties = { fontSize: 9.5, fontWeight: 700, letterSpacing: ".09em", color: "var(--text-3)", textTransform: "uppercase" };
export const input: CSSProperties = {
  width: "100%",
  height: 38,
  borderRadius: "var(--radius-control)",
  background: "var(--bg-deep)",
  border: "1px solid var(--border)",
  padding: "0 10px",
  fontSize: 14,
  color: "var(--text)",
};
export const primary: CSSProperties = {
  background: "var(--accent)",
  color: "var(--bg-deep)",
  border: "none",
  borderRadius: "var(--radius-control)",
  padding: "0 16px",
  height: 38,
  fontWeight: 700,
  fontSize: 13,
  cursor: "pointer",
};
export const ghost: CSSProperties = {
  background: "transparent",
  color: "var(--text-2)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-control)",
  padding: "0 12px",
  height: 32,
  fontWeight: 700,
  fontSize: 12,
  cursor: "pointer",
};
export const danger: CSSProperties = { ...ghost, color: "var(--danger)", borderColor: "var(--danger-border)" };
export const iconButton: CSSProperties = { ...ghost, width: 28, height: 28, padding: 0, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 13 };
export const errorBox: CSSProperties = {
  background: "var(--danger-wash)",
  borderLeft: "3px solid var(--danger)",
  borderRadius: "var(--radius-callout)",
  padding: "8px 10px",
  fontSize: 13,
  color: "var(--danger-text)",
  marginBottom: 12,
};
export const infoBox: CSSProperties = {
  background: "var(--accent-wash)",
  borderLeft: "3px solid var(--accent)",
  borderRadius: "var(--radius-callout)",
  padding: "10px 12px",
  fontSize: 13,
  color: "var(--accent-wash-text)",
  marginBottom: 12,
};
export const chip = (tone: "accent" | "warn" | "muted" | "danger"): CSSProperties => ({
  display: "inline-block",
  fontSize: 10.5,
  fontWeight: 700,
  letterSpacing: ".06em",
  textTransform: "uppercase",
  padding: "2px 7px",
  borderRadius: "var(--radius-micro)",
  border: `1px solid ${tone === "muted" ? "var(--border)" : `var(--${tone})`}`,
  color: tone === "muted" ? "var(--text-3)" : `var(--${tone})`,
  whiteSpace: "nowrap",
});

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export const formatDateTime = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
export const formatDate = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
