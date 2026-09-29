import { useState } from "react";
import { getBackupStatus, inspectBackup, resyncBackup, restoreBackup, setBackupSpreadsheet, syncBackupNow, type BackupStatus } from "../lib/api.js";
import { ApiError } from "../lib/client.js";
import { useData } from "../lib/useData.js";
import { confirmDialog } from "../lib/confirmDialog.js";
import { SetupSubNav } from "../components/SetupSubNav.js";
import { card, chip, danger, errorBox, errorMessage, formatDateTime, ghost, h1, hint, infoBox, input, label, page, primary } from "../lib/ui.js";

export function SetupBackupPage() {
  const status = useData<BackupStatus>(getBackupStatus);
  const [sheet, setSheet] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [counts, setCounts] = useState<{ table: string; sheetRows: number; localRows: number }[] | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(fn: () => Promise<string | void>) {
    setBusy(true);
    setMsg(null);
    try {
      const text = await fn();
      if (text) setMsg({ ok: true, text });
      await status.reload();
    } catch (err) {
      // 503 RATE_LIMITED arrives already translated by the server into a friendly sentence.
      setMsg({ ok: false, text: err instanceof ApiError && err.code === "RATE_LIMITED" ? `Google Sheets is busy right now — try again in ${err.retryAfterSeconds ?? 30} seconds.` : errorMessage(err) });
    } finally {
      setBusy(false);
    }
  }

  const s = status.data;

  return (
    <div style={page}>
      <h1 style={h1}>Setup</h1>
      <SetupSubNav />
      <p style={hint}>
        Every save goes to the database on the NAS first — that's what keeps the app fast. In the background each change is then copied to a Google Sheet (one tab per table), so if the NAS
        ever dies, a new install can be restored from the sheet. The sheet is a mirror only: editing it by hand changes nothing in the app.
      </p>
      {status.error && <div style={errorBox}>{status.error}</div>}
      {msg && <div style={msg.ok ? infoBox : errorBox}>{msg.text}</div>}

      {s && (
        <div style={{ ...card, marginBottom: 12, display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ fontWeight: 700 }}>Mirror status</span>
            {!s.credentials ? (
              <span style={chip("danger")}>No Google credentials on the server</span>
            ) : !s.configured ? (
              <span style={chip("warn")}>No spreadsheet set</span>
            ) : s.lastError ? (
              <span style={chip("warn")}>Retrying</span>
            ) : s.pending > 0 ? (
              <span style={chip("accent")}>Syncing</span>
            ) : (
              <span style={chip("accent")}>Up to date</span>
            )}
          </div>
          <Line k="Spreadsheet" v={s.spreadsheetId ? <a href={`https://docs.google.com/spreadsheets/d/${s.spreadsheetId}/edit`} target="_blank" rel="noreferrer" style={{ color: "var(--accent)" }}>{s.spreadsheetId}</a> : "—"} />
          <Line k="Changes waiting" v={String(s.pending)} />
          <Line k="Last successful sync" v={s.lastSuccessAt ? formatDateTime(s.lastSuccessAt) : "never"} />
          {s.lastError && <Line k="Last problem" v={`${s.lastError}${s.lastErrorAt ? ` (${formatDateTime(s.lastErrorAt)})` : ""}`} />}
          {s.backoffUntil && <Line k="Next retry" v={formatDateTime(s.backoffUntil)} />}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 4 }}>
            <button style={ghost} disabled={busy || !s.configured} onClick={() => run(async () => `Mirrored ${(await syncBackupNow()).mirrored} rows.`)}>
              Sync now
            </button>
            <button style={ghost} disabled={busy || !s.configured} onClick={() => run(async () => setCounts(await inspectBackup()))}>
              Compare row counts
            </button>
            <button style={ghost} disabled={busy || !s.configured} onClick={() => run(async () => `Queued ${(await resyncBackup()).queued} rows for a full re-copy.`)}>
              Full re-copy
            </button>
          </div>
          {counts && (
            <table className="mono" style={{ fontSize: 12, borderCollapse: "collapse", marginTop: 6 }}>
              <thead>
                <tr style={{ color: "var(--text-3)", textAlign: "left" }}>
                  <th style={{ padding: 4 }}>Tab</th>
                  <th style={{ padding: 4 }}>NAS</th>
                  <th style={{ padding: 4 }}>Sheet</th>
                </tr>
              </thead>
              <tbody>
                {counts.map((c) => (
                  <tr key={c.table} style={{ color: c.localRows === c.sheetRows ? "var(--text-2)" : "var(--warn)" }}>
                    <td style={{ padding: 4 }}>{c.table}</td>
                    <td style={{ padding: 4 }}>{c.localRows}</td>
                    <td style={{ padding: 4 }}>{c.sheetRows}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      <div style={{ ...card, marginBottom: 12 }}>
        <div style={{ fontWeight: 700, marginBottom: 4 }}>Backup spreadsheet</div>
        <p style={{ ...hint, margin: "0 0 10px" }}>Create an empty Google Sheet, share it with the service account's e-mail as Editor, then paste its URL here. Everything is copied over automatically.</p>
        <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span className="mono" style={label}>
            Sheet URL or ID
          </span>
          <input value={sheet} onChange={(e) => setSheet(e.target.value)} placeholder="https://docs.google.com/spreadsheets/d/…" style={input} />
        </label>
        <button style={{ ...primary, marginTop: 8 }} disabled={busy || !sheet.trim()} onClick={() => run(async () => { await setBackupSpreadsheet(sheet); setSheet(""); return "Saved — copying everything to the sheet now."; })}>
          Use this sheet
        </button>
      </div>

      <div style={{ ...card, borderColor: "var(--danger-border)" }}>
        <div style={{ fontWeight: 700, marginBottom: 4 }}>Restore from the sheet</div>
        <p style={{ ...hint, margin: "0 0 10px" }}>
          Only for disaster recovery on a <b>fresh</b> NAS database: pulls every template, part, sign-off and user back from the sheet. Restored users come back locked and need a
          new PIN (PINs are never stored in the sheet).
        </p>
        <button
          style={danger}
          disabled={busy || !s?.configured}
          onClick={async () => {
            if (!(await confirmDialog("Restore all data from the backup sheet into this database?", { confirmLabel: "Restore", danger: true }))) return;
            await run(async () => {
              try {
                const { restored } = await restoreBackup(false);
                return `Restored: ${Object.entries(restored).map(([k, v]) => `${k} ${v}`).join(", ")}.`;
              } catch (err) {
                if (err instanceof ApiError && err.code === "NOT_EMPTY" && (await confirmDialog(`${err.message}\n\nMerge the sheet's rows into it anyway?`, { confirmLabel: "Merge anyway", danger: true }))) {
                  const { restored } = await restoreBackup(true);
                  return `Merged: ${Object.entries(restored).map(([k, v]) => `${k} ${v}`).join(", ")}.`;
                }
                throw err;
              }
            });
          }}
        >
          Restore from sheet…
        </button>
      </div>
    </div>
  );
}

function Line({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div style={{ display: "flex", gap: 8, fontSize: 13 }}>
      <span style={{ color: "var(--text-3)", width: 150, flex: "none" }}>{k}</span>
      <span style={{ minWidth: 0, wordBreak: "break-all" }}>{v}</span>
    </div>
  );
}
