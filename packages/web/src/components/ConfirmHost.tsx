import { useConfirmRequest, resolveConfirmRequest } from "../lib/confirmDialog.js";

// Rendered once near the app root (see App.tsx) — shows whatever confirmDialog()/alertDialog()
// currently has pending, styled like the rest of the app instead of a native browser/OS prompt.
export function ConfirmHost() {
  const req = useConfirmRequest();
  if (!req) return null;

  const confirmLabel = req.confirmLabel ?? (req.kind === "alert" ? "OK" : "Confirm");

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(10, 12, 14, 0.55)",
        zIndex: 10000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
      onClick={() => {
        // Clicking the backdrop dismisses like Cancel — never a silent no-op that leaves the
        // operator stuck with no visible way out besides the buttons themselves.
        if (req.kind === "confirm") resolveConfirmRequest(false);
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(92vw, 380px)",
          background: "var(--bg-base)",
          border: "1px solid var(--border-soft)",
          borderRadius: "var(--radius-card)",
          padding: "20px 22px",
          boxShadow: "0 12px 40px rgba(0,0,0,.35)",
        }}
      >
        {req.title && <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text)", marginBottom: 8 }}>{req.title}</div>}
        <div style={{ fontSize: 13.5, color: "var(--text-2)", lineHeight: 1.5, whiteSpace: "pre-line", marginBottom: 20 }}>{req.message}</div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          {req.kind === "confirm" && (
            <button
              type="button"
              onClick={() => resolveConfirmRequest(false)}
              className="mono"
              style={{
                background: "transparent",
                color: "var(--text-2)",
                border: "1px solid var(--border)",
                borderRadius: "var(--radius-control)",
                padding: "0 20px",
                height: 48,
                fontWeight: 700,
                fontSize: 14,
                cursor: "pointer",
              }}
            >
              {req.cancelLabel ?? "Cancel"}
            </button>
          )}
          <button
            type="button"
            onClick={() => resolveConfirmRequest(true)}
            autoFocus
            className="mono"
            style={{
              background: req.danger ? "var(--danger)" : "var(--accent)",
              color: "var(--bg-deep)",
              border: "none",
              borderRadius: "var(--radius-control)",
              padding: "0 20px",
              height: 48,
              fontWeight: 700,
              fontSize: 14,
              cursor: "pointer",
            }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
