import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { mechanismKey, type SignoffSummary } from "@biosite-signoff/shared";
import { getAllSignoffSummaries, getSignoffs, getSignoffsOfType } from "../lib/api.js";
import { pendingCreates } from "../lib/offlineList.js";
import { useData } from "../lib/useData.js";
import { useMe } from "../lib/meContext.js";
import { downloadPdf, viewPdf } from "../lib/pdfLazy.js";
import { mechanismPdfSignoffs, type PdfScope } from "../lib/mechanismPdf.js";
import { stamp, topboxUrl } from "../lib/format.js";
import { SerialInput } from "../components/SerialInput.js";
import { PAGE_SIZE, Pager, pageOf } from "../components/Pager.js";
import { card, chip, errorBox, errorMessage, ghost, input, page, primary } from "../lib/ui.js";

type StatusFilter = "all" | "open" | "done";
/** Starting order of a tab: "progress" = not completed first, newest first; "high" = highest serial on top. */
export type SortMode = "progress" | "high" | "low";

/** A column the list can be sorted by — "check:N" is the N-th check column's date. */
type SortKey = "created" | "serial" | "type" | "visits" | "status" | `check:${number}`;
interface ColumnSort {
  key: SortKey;
  dir: 1 | -1;
}

/** One line of the list: a visit, or (All sign-offs) a TopBox shown by its latest visit. */
interface Row {
  key: string;
  s: SignoffSummary;
  visits: number;
}

const bySerial = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
const progressValue = (s: SignoffSummary) => {
  const [done, total] = s.progress.split("/").map(Number);
  return total ? (done ?? 0) / total : 0;
};
const checkAt = (s: SignoffSummary, i: number) => s.checks?.[i]?.at ?? (i === 0 ? s.firstCheckAt : null);

/**
 * The one list every Sign-offs tab uses — "All sign-offs" and each type (New (UK), Service…) look
 * exactly the same, only what's listed differs: search, status filter, sort, the selection
 * buttons in one fixed toolbar, and one TopBox per line in fixed columns. Tap a column heading to
 * sort by it (again = the other way round); "In progress first" keeps unfinished ones on top
 * whatever the column order. "All sign-offs" lists each TopBox once — its latest visit, with how
 * many visits it has had.
 */
export function SignoffTable(props: { typeId?: string; title: string; startLabel: string; startHref: string; defaultSort: SortMode }) {
  const navigate = useNavigate();
  const me = useMe();
  const { typeId } = props;
  const grouped = !typeId;
  const list = useData<SignoffSummary[]>(async () => {
    const rows = typeId ? await getSignoffsOfType(typeId) : await getAllSignoffSummaries();
    if (typeId) return rows;
    // Started on this device but not synced yet — on top of the All list.
    const pending = (await pendingCreates()).filter((p) => !rows.some((r) => r.id === p.id));
    return [...pending, ...rows];
  }, [typeId]);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [progressFirst, setProgressFirst] = useState(props.defaultSort === "progress");
  const defaultColumn: ColumnSort = props.defaultSort === "progress" ? { key: "created", dir: -1 } : { key: "serial", dir: props.defaultSort === "high" ? -1 : 1 };
  const [column, setColumn] = useState<ColumnSort>(defaultColumn);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);

  // All sign-offs: one line per TopBox (667 and 667R are the same TopBox) — its latest visit.
  const rows: Row[] = (() => {
    const visits = list.data ?? [];
    if (!grouped) return visits.map((s) => ({ key: s.id, s, visits: 1 }));
    const byBox = new Map<string, Row>();
    for (const s of visits) {
      const key = mechanismKey(s.serialNumber);
      const cur = byBox.get(key);
      if (!cur) byBox.set(key, { key, s, visits: 1 });
      else byBox.set(key, { key, s: s.createdAt > cur.s.createdAt ? s : cur.s, visits: cur.visits + 1 });
    }
    return [...byBox.values()];
  })();
  const open = rows.filter((r) => r.s.status !== "complete").length;
  const needle = q.trim().toUpperCase();
  const compare = (a: Row, b: Row): number => {
    const k = column.key;
    if (k === "serial") return bySerial(a.s.serialNumber, b.s.serialNumber);
    if (k === "type") return a.s.typeName.localeCompare(b.s.typeName) || bySerial(a.s.serialNumber, b.s.serialNumber);
    if (k === "visits") return a.visits - b.visits;
    if (k === "status") return progressValue(a.s) - progressValue(b.s);
    if (k === "created") return a.s.createdAt.localeCompare(b.s.createdAt);
    const i = Number(k.slice(6));
    return (checkAt(a.s, i) ?? "").localeCompare(checkAt(b.s, i) ?? "");
  };
  const isDateKey = column.key === "created" || column.key.startsWith("check:");
  const items = rows
    .filter((r) => (status === "all" ? true : status === "done" ? r.s.status === "complete" : r.s.status !== "complete"))
    .filter((r) => !needle || r.s.serialNumber.toUpperCase().includes(needle))
    .sort((a, b) => {
      if (progressFirst) {
        const g = Number(a.s.status === "complete") - Number(b.s.status === "complete");
        if (g) return g;
      }
      // Not done yet (no date) always goes to the bottom, whichever way the dates are sorted.
      if (column.key.startsWith("check:")) {
        const i = Number(column.key.slice(6));
        const na = checkAt(a.s, i) ? 0 : 1;
        const nb = checkAt(b.s, i) ? 0 : 1;
        if (na !== nb) return na - nb;
      }
      return column.dir * compare(a, b) || (isDateKey ? 0 : b.s.createdAt.localeCompare(a.s.createdAt));
    });
  const picked = items.filter((r) => selected.has(r.key));
  // 100 per page; a new search / filter / sort starts again at page 1.
  const [pageNo, setPageNo] = useState(0);
  const pageKey = `${q}|${status}|${progressFirst}|${column.key}|${column.dir}`;
  const [lastKey, setLastKey] = useState(pageKey);
  if (lastKey !== pageKey) {
    setLastKey(pageKey);
    setPageNo(0);
  }
  const lastPage = Math.max(0, Math.ceil(items.length / PAGE_SIZE) - 1);
  const shown = pageOf(items, Math.min(pageNo, lastPage));
  const allShownPicked = shown.length > 0 && shown.every((r) => selected.has(r.key));
  // Column headings: the check labels of the visit with the most checks (usually all the same).
  const checkLabels = items.reduce<string[]>((best, r) => ((r.s.checks?.length ?? 0) > best.length ? r.s.checks!.map((c) => c.label) : best), ["1st Check"]);
  const visitsCol = grouped ? "70px " : "";
  const rowGrid = { display: "grid", gridTemplateColumns: `28px 170px 130px ${visitsCol}150px repeat(${checkLabels.length}, 120px)`, alignItems: "center", columnGap: 12 } as const;

  function toggle(key: string) {
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  /** Tapping a heading: sort by it; tapping it again turns the order round. Dates start newest first. */
  function sortBy(key: SortKey) {
    setColumn((cur) => (cur.key === key ? { key, dir: cur.dir === 1 ? -1 : 1 } : { key, dir: key.startsWith("check:") || key === "visits" ? -1 : 1 }));
  }

  /** One PDF, in the order shown on screen — downloaded, or opened here to view. "all" = every visit of each TopBox. */
  async function pdf(view: boolean, scope: PdfScope = "latest") {
    if (picked.length === 0) return;
    setBusy(true);
    setPdfError(null);
    try {
      const load = () => (scope === "all" ? mechanismPdfSignoffs(picked.map((r) => r.s.serialNumber), "all") : getSignoffs(picked.map((r) => r.s.id)));
      if (view) viewPdf(load);
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
          <div style={{ fontSize: 12.5, color: "var(--text-3)", minHeight: 18 }}>{list.data ? `${rows.length} in total · ${rows.length - open} completed · ${open} not completed` : ""}</div>
        </div>
        {me.role !== "viewer" && me.canStart !== false && (
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
        <button style={segment(progressFirst)} onClick={() => setProgressFirst((v) => !v)} aria-pressed={progressFirst} title="Keep the not completed ones on top, whatever the column order">
          {progressFirst ? "☑" : "☐"} In progress first
        </button>
        <div style={{ display: "flex" }} role="group" aria-label="Sort by serial number">
          <button style={{ ...segment(column.key === "serial" && column.dir === -1), borderTopRightRadius: 0, borderBottomRightRadius: 0 }} onClick={() => setColumn({ key: "serial", dir: -1 })} aria-pressed={column.key === "serial" && column.dir === -1} title="Highest serial number on top">
            Serial: High ↑
          </button>
          <button style={{ ...segment(column.key === "serial" && column.dir === 1), borderTopLeftRadius: 0, borderBottomLeftRadius: 0, marginLeft: -1 }} onClick={() => setColumn({ key: "serial", dir: 1 })} aria-pressed={column.key === "serial" && column.dir === 1} title="Lowest serial number on top">
            Low ↓
          </button>
        </div>
        {/* Always here (greyed until something is ticked), so ticking never shifts the list. */}
        <div style={{ display: "flex", gap: 8, alignItems: "center", justifyContent: "flex-end", flexWrap: "wrap", flexBasis: "100%" }}>
          <span style={{ fontSize: 13, color: picked.length ? "var(--text)" : "var(--text-3)", minWidth: 80, textAlign: "right" }}>{picked.length} selected</span>
          <button style={{ ...ghost, height: 52 }} onClick={() => setSelected(new Set())} disabled={picked.length === 0}>
            Clear
          </button>
          <button style={{ ...ghost, height: 52, opacity: picked.length === 0 ? 0.45 : 1 }} onClick={() => void pdf(true)} disabled={busy || picked.length === 0} title="Look at the PDF here — then save, print or close">
            View PDF
          </button>
          <button style={{ ...primary, height: 52, opacity: picked.length === 0 ? 0.45 : 1 }} onClick={() => void pdf(false)} disabled={busy || picked.length === 0} title="Download the PDF">
            {busy ? "Generating…" : "Generate PDF"}
          </button>
          {grouped && (
            <button style={{ ...ghost, height: 52, borderColor: "var(--accent)", color: "var(--accent)", opacity: picked.length === 0 ? 0.45 : 1 }} onClick={() => void pdf(false, "all")} disabled={busy || picked.length === 0} title="Every visit of each selected TopBox — its whole history">
              PDF all visits
            </button>
          )}
        </div>
      </div>

      {(list.error || pdfError) && <div style={errorBox}>{pdfError ?? list.error}</div>}
      {!list.data && !list.error && <div style={{ color: "var(--text-3)", fontSize: 13 }}>Loading…</div>}
      {list.data && items.length === 0 && <div style={{ color: "var(--text-4)", fontSize: 14 }}>Nothing matches.</div>}

      <Pager page={Math.min(pageNo, lastPage)} total={items.length} onPage={setPageNo} />
      {items.length > 0 && (
        <label style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13, color: "var(--text-3)", margin: "0 0 8px 14px", cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={allShownPicked}
            onChange={(e) =>
              setSelected((cur) => {
                const next = new Set(cur);
                for (const r of shown) e.target.checked ? next.add(r.key) : next.delete(r.key);
                return next;
              })
            }
            style={{ width: 24, height: 24, accentColor: "var(--accent)" }}
          />
          Select all{items.length > PAGE_SIZE ? " on this page" : ""}
        </label>
      )}
      {/* One TopBox per line, in fixed columns: serial · type · status · each check's date. */}
      <div style={{ overflowX: "auto" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 28 + 170 + 130 + (grouped ? 70 + 12 : 0) + 150 + checkLabels.length * 120 + 12 * (3 + checkLabels.length) + 28 }}>
          {items.length > 0 && (
            <div style={{ ...rowGrid, padding: "0 14px" }}>
              <span />
              <SortHeading label="Serial number" k="serial" column={column} onSort={sortBy} />
              <SortHeading label="Type" k="type" column={column} onSort={sortBy} />
              {grouped && <SortHeading label="Visits" k="visits" column={column} onSort={sortBy} />}
              <SortHeading label="Status" k="status" column={column} onSort={sortBy} />
              {checkLabels.map((l, ci) => (
                <SortHeading key={l} label={l} k={`check:${ci}`} column={column} onSort={sortBy} />
              ))}
            </div>
          )}
          {shown.map(({ key, s, visits }) => (
            <div key={key} style={{ ...card, ...rowGrid, padding: "12px 14px", borderColor: selected.has(key) ? "var(--accent)" : "var(--border-soft)" }}>
              <input type="checkbox" checked={selected.has(key)} onChange={() => toggle(key)} aria-label={`Select ${s.serialNumber}`} style={{ width: 28, height: 28, accentColor: "var(--accent)" }} />
              <Link to={grouped ? topboxUrl(s.serialNumber) : topboxUrl(s.serialNumber, s.id)} className="mono" style={{ fontSize: 18, fontWeight: 700, color: "inherit", textDecoration: "none", overflow: "hidden", textOverflow: "ellipsis" }}>
                {s.serialNumber}
              </Link>
              <span style={{ fontSize: 13, color: "var(--text-2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.typeName}</span>
              {grouped && (
                <span className="mono" style={{ fontSize: 14, color: "var(--text-2)" }} title={`${visits} visit${visits === 1 ? "" : "s"} of this TopBox`}>
                  {visits}
                </span>
              )}
              <span>
                <span style={chip(s.status === "complete" ? "accent" : "warn")}>{s.status === "complete" ? "Complete" : `In progress ${s.progress}`}</span>
              </span>
              {checkLabels.map((label, ci) => {
                const at = checkAt(s, ci);
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
      <Pager page={Math.min(pageNo, lastPage)} total={items.length} onPage={setPageNo} />
    </div>
  );
}

/** A column heading that sorts the list: ▲ / ▼ shows the column and direction in use. */
function SortHeading({ label, k, column, onSort }: { label: string; k: SortKey; column: ColumnSort; onSort: (k: SortKey) => void }) {
  const on = column.key === k;
  return (
    <button
      type="button"
      onClick={() => onSort(k)}
      aria-label={`Sort by ${label}`}
      title={`Sort by ${label}`}
      style={{
        all: "unset",
        cursor: "pointer",
        padding: "8px 0",
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: ".06em",
        textTransform: "uppercase",
        color: on ? "var(--accent)" : "var(--text-3)",
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
      }}
    >
      {label} <span style={{ opacity: on ? 1 : 0.35 }}>{on ? (column.dir === 1 ? "▲" : "▼") : "↕"}</span>
    </button>
  );
}
