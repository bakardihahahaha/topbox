import { useState } from "react";
import { useSaving, useSavingCount } from "../lib/savingStatus.js";
import { dismissQueueFailures, flushQueue } from "../lib/offlineQueue.js";
import { useOnline, useQueueCount, useQueueFailures } from "../lib/useOfflineStatus.js";

// Same convention as Biosite KPI's SyncStatusDot: a small status dot next to the account menu
// that's actually clickable — tapping it opens a floating panel (dismissed by tapping the
// invisible full-screen backdrop behind it, same as every other overlay in the app) spelling out
// what the dot's color means, with a "Sync now" button to force a retry and, when something
// genuinely failed, the recent error messages with a way to dismiss them. Previously the dot had
// no click handler at all, so tapping it did nothing even when there was real sync info to show.
export function SavingIndicator() {
  const saving = useSaving();
  const savingCount = useSavingCount();
  const online = useOnline();
  const pending = useQueueCount();
  const failures = useQueueFailures();
  const [open, setOpen] = useState(false);

  // A same-device online save (the common case — nothing offline-queued at all) never shows up
  // here as "pending" on its own: only once useSaving()'s own debounce has decided this is worth
  // showing (SHOW_DELAY_MS has passed) does the live in-flight count join the number — a normal
  // fast save still flashes nothing, but a sync the operator can actually see (a multi-item batch
  // pick, a slow connection) no longer shows a bare "Saving…" with nothing telling them how much
  // is still in flight.
  const totalPending = pending + (saving ? savingCount : 0);

  const color = failures.length > 0 ? "var(--danger)" : !online ? "var(--warn)" : pending > 0 || saving ? "var(--accent)" : "var(--text-4)";
  const badgeCount = totalPending + failures.length;
  // Pending count is appended regardless of online/offline — KPI's own SyncStatusDot does the
  // same (`${offlineBannerOffline} · ${count} pending`): being offline is exactly when knowing
  // how many changes are queued up matters most, so it must never be the one state that hides it.
  const statusText =
    (!online ? "Offline — changes are saved on this device and will sync automatically" : pending > 0 ? "Syncing…" : saving ? "Saving…" : "Up to date") +
    (totalPending > 0 ? ` · ${totalPending} pending` : "");
  const barVisible = failures.length > 0 || !online || pending > 0 || saving;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={statusText}
        aria-label={statusText}
        className="mono"
        style={{ display: "flex", alignItems: "center", gap: 4, height: 24, padding: "0 4px", border: "none", background: "transparent", cursor: "pointer", flex: "none" }}
      >
        <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: color, transition: "background 0.2s", flex: "none" }} />
        {badgeCount > 0 && <span style={{ fontSize: 10.5, fontWeight: 700, color: "var(--text-2)" }}>{badgeCount}</span>}
      </button>

      {open && <div onClick={() => setOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 69 }} />}
      {open && (
        <div
          className="mono"
          style={{
            position: "fixed",
            top: 48,
            right: 12,
            left: 12,
            zIndex: 70,
            maxWidth: 360,
            marginLeft: "auto",
            borderRadius: "var(--radius-card)",
            border: "1px solid var(--border)",
            background: "var(--bg-base)",
            boxShadow: "0 8px 24px rgba(0,0,0,.35)",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 10,
              padding: "10px 14px",
              background: !online ? "var(--warn)" : totalPending > 0 ? "var(--accent)" : "var(--surface-alt)",
              color: !online || totalPending > 0 ? "var(--bg-deep)" : "var(--text)",
            }}
          >
            <span style={{ fontSize: 12, fontWeight: 600 }}>{statusText}</span>
            <button
              type="button"
              onClick={() => void flushQueue()}
              className="mono"
              style={{
                flex: "none",
                height: 26,
                padding: "0 10px",
                borderRadius: "var(--radius-control)",
                border: "1px solid currentColor",
                background: "transparent",
                color: "inherit",
                fontWeight: 700,
                fontSize: 11,
                cursor: "pointer",
              }}
            >
              Sync now
            </button>
          </div>

          {failures.length > 0 && (
            <div style={{ background: "var(--danger)", color: "#fff" }}>
              <div style={{ padding: "8px 14px", fontSize: 12, fontWeight: 600 }}>
                {failures.length} sync {failures.length === 1 ? "error" : "errors"}
              </div>
              <div style={{ padding: "0 14px 10px", display: "flex", flexDirection: "column", gap: 6 }}>
                {failures.map((f, i) => (
                  <div key={i} style={{ background: "rgba(0,0,0,0.15)", borderRadius: "var(--radius-callout)", padding: "6px 10px", fontSize: 11.5, wordBreak: "break-word" }}>
                    {f}
                  </div>
                ))}
              </div>
              <div style={{ padding: "0 14px 10px" }}>
                <button
                  type="button"
                  onClick={dismissQueueFailures}
                  className="mono"
                  style={{ height: 26, padding: "0 10px", borderRadius: "var(--radius-control)", border: "1px solid #fff", background: "transparent", color: "#fff", fontWeight: 700, fontSize: 11, cursor: "pointer" }}
                >
                  Dismiss
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      <div
        aria-hidden="true"
        style={{
          position: "fixed",
          left: 0,
          right: 0,
          bottom: 0,
          height: 10,
          background: color,
          opacity: barVisible ? 1 : 0,
          transition: "opacity 0.25s",
          zIndex: 60,
          pointerEvents: "none",
        }}
      />
    </>
  );
}
