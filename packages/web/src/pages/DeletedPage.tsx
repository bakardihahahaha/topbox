import { useState } from "react";
import { deleteSignoffForever, getDeletedSignoffs, restoreSignoff, type DeletedSignoff } from "../lib/api.js";
import { useData } from "../lib/useData.js";
import { confirmDialog } from "../lib/confirmDialog.js";
import { localStamp, stamp } from "../lib/format.js";
import { Pager, pageOf } from "../components/Pager.js";
import { card, chip, danger, errorBox, errorMessage, ghost, h1, hint, infoBox, page } from "../lib/ui.js";

/**
 * Admin only: every deleted sign-off (operators and admins delete — softly). Restore puts it
 * back in its TopBox's history exactly where it was (by date); Delete forever removes it and its
 * photos for good. The tab only shows while something is in here.
 */
export function DeletedPage() {
  const list = useData<DeletedSignoff[]>(getDeletedSignoffs);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [pageNo, setPageNo] = useState(0);
  const items = list.data ?? [];

  async function act(s: DeletedSignoff, forever: boolean) {
    const what = `${s.typeName} sign-off of ${s.serialNumber}`;
    const ok = await confirmDialog(
      forever
        ? `Delete the ${what} forever?\n\nIts checks, signatures, photos and parts are removed for good. This can't be undone.`
        : `Restore the ${what}?\n\nIt goes back into the TopBox's history where it was (by date) and shows in the lists again.`,
      { confirmLabel: forever ? "Delete forever" : "Restore", danger: forever },
    );
    if (!ok) return;
    setBusy(s.id);
    setError(null);
    setDone(null);
    try {
      if (forever) await deleteSignoffForever(s.id);
      else await restoreSignoff(s.id);
      setDone(forever ? `${what} deleted forever.` : `${what} restored.`);
      await list.reload();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  const cols = { display: "grid", gridTemplateColumns: "120px 110px 150px 100px minmax(130px, 1fr) auto", alignItems: "center", columnGap: 12 } as const;

  return (
    <div style={page}>
      <h1 style={h1}>Deleted sign-offs</h1>
      <p style={hint}>
        Sign-offs someone deleted. <b>Restore</b> puts one back exactly where it was in its TopBox&apos;s history. <b>Delete forever</b> removes it with its photos — only possible here, only
        for admins. A TopBox&apos;s other visits are never affected by deleting one of them.
      </p>
      {error && <div style={errorBox}>{error}</div>}
      {done && <div style={infoBox}>{done}</div>}
      {list.error && <div style={errorBox}>{list.error}</div>}
      {list.data && items.length === 0 && <div style={{ color: "var(--text-4)", fontSize: 14 }}>Nothing deleted.</div>}
      <Pager page={pageNo} total={items.length} onPage={setPageNo} />
      <div style={{ overflowX: "auto" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 860 }}>
          {items.length > 0 && (
            <div style={{ ...cols, padding: "0 14px", fontSize: 11, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--text-3)" }}>
              <span>Serial number</span>
              <span>Type</span>
              <span>Status</span>
              <span>1st check</span>
              <span>Deleted</span>
              <span />
            </div>
          )}
          {pageOf(items, pageNo).map((s) => (
            <div key={s.id} style={{ ...card, ...cols, padding: "12px 14px" }}>
              <span className="mono" style={{ fontSize: 18, fontWeight: 700 }}>
                {s.serialNumber}
              </span>
              <span style={{ fontSize: 13, color: "var(--text-2)" }}>{s.typeName}</span>
              <span>
                <span style={chip(s.status === "complete" ? "accent" : "warn")}>{s.status === "complete" ? "Complete" : `In progress ${s.progress}`}</span>
              </span>
              <span className="mono" style={{ fontSize: 13, color: "var(--text-2)" }}>
                {s.firstCheckAt ? stamp(s.firstCheckAt.slice(0, 10)) : "—"}
              </span>
              <span style={{ fontSize: 13, color: "var(--text-2)" }}>
                <span className="mono">{localStamp(s.deletedAt).slice(0, 10)}</span>
                {s.deletedBy ? ` · by ${s.deletedBy}` : ""}
              </span>
              <span style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                <button style={{ ...ghost, height: 48 }} disabled={busy !== null} onClick={() => void act(s, false)}>
                  Restore
                </button>
                <button style={{ ...danger, height: 48 }} disabled={busy !== null} onClick={() => void act(s, true)}>
                  Delete forever
                </button>
              </span>
            </div>
          ))}
        </div>
      </div>
      <Pager page={pageNo} total={items.length} onPage={setPageNo} />
    </div>
  );
}
