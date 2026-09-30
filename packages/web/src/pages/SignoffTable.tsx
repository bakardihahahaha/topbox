import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { SignoffSummary } from "@biosite-signoff/shared";
import { getAllSignoffSummaries, getSignoffs, getSignoffsOfType } from "../lib/api.js";
import { pendingCreates } from "../lib/offlineList.js";
import { useData } from "../lib/useData.js";
import { useMe } from "../lib/meContext.js";
import { downloadPdf, openPdf } from "../lib/pdfLazy.js";
import { stamp, topboxUrl } from "../lib/format.js";
import { SerialInput } from "../components/SerialInput.js";
import { card, chip, errorBox, errorMessage, ghost, input, page, primary } from "../lib/ui.js";

type StatusFilter = "all" | "open" | "done";
/** "progress": not completed first, then completed — newest first within each. */
export type SortMode = "progress" | "high" | "low";

/**
 * The one list every Sign-offs tab uses — "All sign-offs" and each type (New (UK), Service…) look
 * exactly the same, only what's listed differs: search, status filter, sort, the selection
 * buttons in one fixed toolbar, and one numbered TopBox per line in fixed columns.
 */
export function SignoffTable(props: { typeId?: string; title: string; startLabel: string; startHref: string; defaultSort: SortMode }) {
  const navigate = useNavigate();
  const me = useMe();
  const { typeId } = props;
  const list = useData<SignoffSummary[]>(async () => {
    const rows = typeId ? await getSignoffsOfType(typeId) : await getAllSignoffSummaries();
    if (typeId) return rows;
    // Started on this device but not synced yet — on top of the All list.
    const pending = (await pendingCreates()).filter((p) => !rows.some((r) => r.id === p.id));
    return [...pending, ...rows];
  }, [typeId]);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [sort, setSort] = useState<SortMode>(props.defaultSort);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);

  const all = list.data ?? [];
  const open = all.filter((s) => s.status !== "complete").length;
  const bySerial = (a: SignoffSummary, b: SignoffSummary) => a.serialNumber.localeCompare(b.serialNumber, undefined, { numeric: true, sensitivity: "base" });
  const needle = q.trim().toUpperCase();
  const items = all
    .filter((s) => (status === "all" ? true : status === "done" ? s.status === "complete" : s.status !== "complete"))
    .filter((s) => !needle || s.serialNumber.toUpperCase().includes(needle))
    .sort((a, b) =>
      sort === "high"
        ? -bySerial(a, b)
        : sort === "low"
          ? bySerial(a, b)
          : Number(a.status === "complete") - Number(b.status === "complete") || b.createdAt.localeCompare(a.createdAt),
    );
  const picked = items.filter((s) => selected.has(s.id));
  // Column headings: the check labels of the visit with the most checks (usually all the same).
  const checkLabels = items.reduce<string[]>((best, s) => ((s.checks?.length ?? 0) > best.length ? s.checks!.map((c) => c.label) : best), ["1st Check"]);
  const rowGrid = { display: "grid", gridTemplateColumns: `28px 40px 170px 130px 150px repeat(${checkLabels.length}, 120px)`, alignItems: "center", columnGap: 12 } as const;

  function toggle(id: string) {
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  /** One PDF, in the order shown on screen — downloaded, or opened in a new tab to view. */
  async function pdf(view: boolean) {
    if (picked.length === 0) return;
    setBusy(true);
    setPdfError(null);
    try {
      const load = () => getSignoffs(picked.map((s) => s.id));
      if (view) await openPdf(load);
      else await downloadPdf(await load());
    } catch (err) {
      setPdfError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const segment = (on: boolean) => ({
    ...ghost,
    height: 52,
    borderColor: on ? "var(--accent)" : "var(--border)",
    background: on ? "var(--accent-wash)" : "transparent",
    color: on ? "var(--accent)" : "var(--text-2)",
  });

  return (
    <div style={page}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 12, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 700 }}>
            {props.title} — {list.data ? items.length : "…"} TopBox{items.length === 1 ? "" : "es"}
          </div>
          <div style={{ fontSize: 12.5, color: "var(--text-3)", minHeight: 18 }}>{list.data ? `${all.length} in total · ${all.length - open} completed · ${open} not completed` : ""}</div>
        </div>
        {me.role !== "viewer" && (
          <button style={{ ...primary, height: 52, minWidth: 200 }} onClick={() => navigate(props.startHref)}>
            {props.startLabel}
          </button>
        )}
      </div>

      <div style={{ marginBottom: 8 }}>
        <SerialInput value={q} onChange={setQ} placeholder="Search serial number" ariaLabel="Search serial number" style={{ height: 52, fontSize: 17 }} />
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12, alignItems: "center" }}>
        <select value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)} aria-label="Status" style={{ ...input, width: "auto", minWidth: 190, height: 52 }}>
          <option value="all">All</option>
          <option value="open">Not completed</option>
          <option value="done">Completed</option>
        </select>
        <div style={{ display: "flex" }} role="group" aria-label="Sort">
          <button style={{ ...segment(sort === "progress"), borderTopRightRadius: 0, borderBottomRightRadius: 0 }} onClick={() => setSort("progress")} aria-pressed={sort === "progress"} title="Not completed first, newest first">
            In progress first
          </button>
          <button style={{ ...segment(sort === "high"), borderRadius: 0, marginLeft: -1 }} onClick={() => setSort("high")} aria-pressed={sort === "high"} title="Highest serial number on top">
            Serial: High ↑
          </button>
          <button style={{ ...segment(sort === "low"), borderTopLeftRadius: 0, borderBottomLeftRadius: 0, marginLeft: -1 }} onClick={() => setSort("low")} aria-pressed={sort === "low"} title="Lowest serial number on top">
            Low ↓
          </button>
        </div>
        {/* Always here (greyed until something is ticked), so ticking never shifts the list. */}
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginLeft: "auto" }}>
          <span style={{ fontSize: 13, color: picked.length ? "var(--text)" : "var(--text-3)", minWidth: 80, textAlign: "right" }}>{picked.length} selected</span>
          <button style={{ ...ghost, height: 52 }} onClick={() => setSelected(new Set())} disabled={picked.length === 0}>
            Clear
          </button>
          <button style={{ ...ghost, height: 52, opacity: picked.length === 0 ? 0.45 : 1 }} onClick={() => void pdf(true)} disabled={busy || picked.length === 0} title="Open the PDF in a new tab">
            View PDF
          </button>
          <button style={{ ...primary, height: 52, opacity: picked.length === 0 ? 0.45 : 1 }} onClick={() => void pdf(false)} disabled={busy || picked.length === 0} title="Download the PDF">
            {busy ? "Generating…" : "Generate PDF"}
          </button>
        </div>
      </div>

      {(list.error || pdfError) && <div style={errorBox}>{pdfError ?? list.error}</div>}
      {!list.data && !list.error && <div style={{ color: "var(--text-3)", fontSize: 13 }}>Loading…</div>}
      {list.data && items.length === 0 && <div style={{ color: "var(--text-4)", fontSize: 14 }}>Nothing matches.</div>}

      {items.length > 0 && (
        <label style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13, color: "var(--text-3)", margin: "0 0 8px 14px", cursor: "pointer" }}>
          <input type="checkbox" checked={picked.length === items.length} onChange={(e) => setSelected(e.target.checked ? new Set(items.map((s) => s.id)) : new Set())} style={{ width: 24, height: 24, accentColor: "var(--accent)" }} />
          Select all
        </label>
      )}
      {/* One TopBox per line, in fixed columns: serial · type · status · each check's date. */}
      <div style={{ overflowX: "auto" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 28 + 40 + 170 + 130 + 150 + checkLabels.length * 120 + 12 * (4 + checkLabels.length) + 28 }}>
          {items.length > 0 && (
            <div style={{ ...rowGrid, padding: "0 14px", fontSize: 11, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--text-3)" }}>
              <span />
              <span />
              <span>Serial number</span>
              <span>Type</span>
              <span>Status</span>
              {checkLabels.map((l) => (
                <span key={l}>{l}</span>
              ))}
            </div>
          )}
          {items.map((s, i) => (
            <div key={s.id} style={{ ...card, ...rowGrid, padding: "12px 14px", borderColor: selected.has(s.id) ? "var(--accent)" : "var(--border-soft)" }}>
              <input type="checkbox" checked={selected.has(s.id)} onChange={() => toggle(s.id)} aria-label={`Select ${s.serialNumber}`} style={{ width: 28, height: 28, accentColor: "var(--accent)" }} />
              <span className="mono" style={{ textAlign: "right", color: "var(--text-3)", fontSize: 14 }}>
                {i + 1}.
              </span>
              <Link to={topboxUrl(s.serialNumber, s.id)} className="mono" style={{ fontSize: 18, fontWeight: 700, color: "inherit", textDecoration: "none", overflow: "hidden", textOverflow: "ellipsis" }}>
                {s.serialNumber}
              </Link>
              <span style={{ fontSize: 13, color: "var(--text-2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.typeName}</span>
              <span>
                <span style={chip(s.status === "complete" ? "accent" : "warn")}>{s.status === "complete" ? "Complete" : `In progress ${s.progress}`}</span>
              </span>
              {checkLabels.map((label, ci) => {
                const at = s.checks?.[ci]?.at ?? (ci === 0 ? s.firstCheckAt : null);
                return (
                  <span key={label} className="mono" style={{ fontSize: 13, color: at ? "var(--text-2)" : "var(--text-4)" }}>
                    {at ? stamp(at.slice(0, 10)) : "—"}
                  </span>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
