import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { SignoffSummary } from "@biosite-signoff/shared";
import { getSignoffs, getSignoffsOfType } from "../lib/api.js";
import { downloadPdf } from "../lib/pdfLazy.js";
import { useData } from "../lib/useData.js";
import { useMe } from "../lib/meContext.js";
import { useSignoffTypes } from "../lib/signoffTypes.js";
import { stamp, topboxUrl } from "../lib/format.js";
import { SignoffsListPage } from "./SignoffsListPage.js";
import { card, chip, errorBox, errorMessage, ghost, input, page, primary } from "../lib/ui.js";

// The home screen: one tab per sign-off type (Setup → Types) listing every TopBox made as that
// type, filterable by completed / not completed and sorted by serial number. "All sign-offs" is
// the full searchable list — and the tab the screen always opens on.
const ALL = "__all";

export function HomePage() {
  const types = useSignoffTypes();
  const [tab, setTab] = useState<string>(ALL);
  const active = tab === ALL || types.some((t) => t.id === tab) ? tab : ALL;

  return (
    <div>
      <div style={{ ...page, paddingBottom: 0 }}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", borderBottom: "1px solid var(--border-soft)", paddingBottom: 12 }}>
          {[...types.map((t) => ({ id: t.id, label: t.name })), { id: ALL, label: "All sign-offs" }].map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              style={{
                height: 52,
                padding: "0 20px",
                borderRadius: "var(--radius-control)",
                border: `1px solid ${active === t.id ? "var(--accent)" : "var(--border)"}`,
                background: active === t.id ? "var(--accent-wash)" : "transparent",
                color: active === t.id ? "var(--accent)" : "var(--text-2)",
                fontWeight: 700,
                fontSize: 15,
                cursor: "pointer",
              }}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>
      {active === ALL ? <SignoffsListPage /> : <TypeTab typeId={active} typeName={types.find((t) => t.id === active)?.name ?? ""} />}
    </div>
  );
}

type StatusFilter = "all" | "open" | "done";

/** One sign-off type: every TopBox (visit) ever made as that type, whatever its stage — one per
 * line, numbered, filtered by completed / not completed, sorted by serial number either way.
 * Tick some (or use "all shown") for one PDF of their test sheets. */
function TypeTab({ typeId, typeName }: { typeId: string; typeName: string }) {
  const navigate = useNavigate();
  const me = useMe();
  const list = useData<SignoffSummary[]>(() => getSignoffsOfType(typeId), [typeId]);
  const [status, setStatus] = useState<StatusFilter>("all");
  const [descending, setDescending] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const all = list.data ?? [];
  const open = all.filter((s) => s.status !== "complete").length;
  const items = all
    .filter((s) => (status === "all" ? true : status === "done" ? s.status === "complete" : s.status !== "complete"))
    .sort((a, b) => (descending ? -1 : 1) * a.serialNumber.localeCompare(b.serialNumber, undefined, { numeric: true, sensitivity: "base" }));
  const picked = items.filter((s) => selected.has(s.id));
  // Column headings: the check labels of the visit with the most checks (usually all the same).
  const checkLabels = items.reduce<string[]>((best, s) => ((s.checks?.length ?? 0) > best.length ? s.checks!.map((c) => c.label) : best), ["1st Check"]);
  const rowGrid = { display: "grid", gridTemplateColumns: `28px 40px 180px 150px repeat(${checkLabels.length}, 130px)`, alignItems: "center", columnGap: 12 } as const;
  const segment = (on: boolean) => ({
    ...ghost,
    height: 52,
    borderColor: on ? "var(--accent)" : "var(--border)",
    background: on ? "var(--accent-wash)" : "transparent",
    color: on ? "var(--accent)" : "var(--text-2)",
  });

  function toggle(id: string) {
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  /** One PDF, in the order shown on screen. */
  async function pdf(of: SignoffSummary[]) {
    if (of.length === 0) return;
    setBusy(true);
    setPdfError(null);
    try {
      await downloadPdf(await getSignoffs(of.map((s) => s.id)));
    } catch (err) {
      setPdfError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={page}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 12, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 700 }}>
            {typeName} — {list.data ? items.length : "…"} TopBox{items.length === 1 ? "" : "es"}
          </div>
          {list.data && (
            <div style={{ fontSize: 12.5, color: "var(--text-3)" }}>
              {all.length} made as {typeName} · {all.length - open} completed · {open} not completed
            </div>
          )}
        </div>
        {me.role !== "viewer" && (
          <button style={{ ...primary, height: 52 }} onClick={() => navigate(`/signoffs/new?typeId=${encodeURIComponent(typeId)}`)}>
            + Start {typeName}
          </button>
        )}
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
        <select value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)} aria-label="Status" style={{ ...input, width: "auto", minWidth: 200, height: 52 }}>
          <option value="all">All</option>
          <option value="open">Not completed</option>
          <option value="done">Completed</option>
        </select>
        {/* Serial number order: High ↑ = highest on top, Low ↓ = lowest on top. */}
        <div style={{ display: "flex" }} role="group" aria-label="Sort by serial number">
          <button style={{ ...segment(descending), borderTopRightRadius: 0, borderBottomRightRadius: 0 }} onClick={() => setDescending(true)} aria-pressed={descending}>
            Serial: High ↑
          </button>
          <button style={{ ...segment(!descending), borderTopLeftRadius: 0, borderBottomLeftRadius: 0, marginLeft: -1 }} onClick={() => setDescending(false)} aria-pressed={!descending}>
            Low ↓
          </button>
        </div>
        {/* Always here (greyed until something is ticked), so ticking never shifts the list. */}
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginLeft: "auto" }}>
          <span style={{ fontSize: 13, color: "var(--text-3)", minWidth: 80, textAlign: "right" }}>{picked.length} selected</span>
          <button style={{ ...ghost, height: 52 }} onClick={() => setSelected(new Set())} disabled={picked.length === 0}>
            Clear
          </button>
          <button style={{ ...primary, height: 52, opacity: picked.length === 0 ? 0.45 : 1 }} onClick={() => void pdf(picked)} disabled={busy || picked.length === 0}>
            {busy ? "Generating…" : "Generate PDF"}
          </button>
        </div>
      </div>
      {(list.error || pdfError) && <div style={errorBox}>{pdfError ?? list.error}</div>}
      {list.data && items.length === 0 && <div style={{ color: "var(--text-4)", fontSize: 14 }}>No {status === "done" ? "completed " : status === "open" ? "unfinished " : ""}{typeName} TopBoxes.</div>}

      {items.length > 0 && (
        <label style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13, color: "var(--text-3)", margin: "0 0 8px 14px", cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={picked.length === items.length}
            onChange={(e) => setSelected(e.target.checked ? new Set(items.map((s) => s.id)) : new Set())}
            style={{ width: 24, height: 24, accentColor: "var(--accent)" }}
          />
          Select all
        </label>
      )}
      {/* One TopBox per line, in fixed columns: serial · status · each check's date. */}
      <div style={{ overflowX: "auto" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 180 + 150 + 120 + checkLabels.length * 130 }}>
          {items.length > 0 && (
            <div style={{ ...rowGrid, padding: "0 14px", fontSize: 11, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--text-3)" }}>
              <span />
              <span />
              <span>Serial number</span>
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
