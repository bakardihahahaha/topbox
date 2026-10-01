import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { MechanismSummary } from "@biosite-signoff/shared";
import { listMechanisms } from "../lib/api.js";
import { useData } from "../lib/useData.js";
import { SerialInput } from "../components/SerialInput.js";
import { Pager, pageOf } from "../components/Pager.js";
import { stamp, topboxUrl } from "../lib/format.js";
import { card, chip, errorBox, errorMessage, ghost, h1, hint, page, primary } from "../lib/ui.js";
import { mechanismPdfSignoffs, type PdfScope } from "../lib/mechanismPdf.js";
import { downloadPdf } from "../lib/pdfLazy.js";

/** Every mechanism (serial number) with its visits and whether the latest one is complete. */
export function MechanismsPage() {
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);
  const list = useData<MechanismSummary[]>(() => listMechanisms(debounced || undefined), [debounced]);
  // 100 per page; a new search starts again at page 1.
  const [pageNo, setPageNo] = useState(0);
  useEffect(() => setPageNo(0), [debounced]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);

  function toggle(serial: string) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(serial)) next.delete(serial);
      else next.add(serial);
      return next;
    });
  }

  async function generate(scope: PdfScope) {
    setBusy(true);
    setPdfError(null);
    try {
      await downloadPdf(await mechanismPdfSignoffs([...selected], scope));
    } catch (err) {
      setPdfError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={page}>
      <h1 style={h1}>Mechanisms</h1>
      <p style={hint}>Each serial number with all its visits and when each check was done. Tap one for its full history.</p>
      <div style={{ marginBottom: 12 }}>
        <SerialInput value={q} onChange={setQ} placeholder="Search serial number" ariaLabel="Search serial number" style={{ height: 52, fontSize: 17 }} />
      </div>
      {/* Always here (greyed until something is ticked), so ticking never shifts the list. */}
      <div style={{ ...card, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 12, position: "sticky", top: 0, zIndex: 5, flexWrap: "wrap" }}>
        <span style={{ fontSize: 13, color: selected.size ? "var(--text)" : "var(--text-3)" }}>
          {selected.size} TopBox{selected.size === 1 ? "" : "es"} selected
        </span>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button style={ghost} onClick={() => setSelected(new Set())} disabled={busy || selected.size === 0}>
            Clear
          </button>
          <button style={{ ...primary, opacity: selected.size === 0 ? 0.45 : 1 }} onClick={() => void generate("latest")} disabled={busy || selected.size === 0} title="Each TopBox's most recent visit">
            {busy ? "Generating…" : "PDF — latest visit"}
          </button>
          <button style={{ ...ghost, borderColor: "var(--accent)", color: "var(--accent)", opacity: selected.size === 0 ? 0.45 : 1 }} onClick={() => void generate("all")} disabled={busy || selected.size === 0} title="Every visit of each TopBox — its whole history">
            PDF — all visits
          </button>
        </div>
      </div>
      {pdfError && <div style={errorBox}>{pdfError}</div>}
      {list.error && <div style={errorBox}>{list.error}</div>}
      {list.data?.length === 0 && <div style={{ color: "var(--text-4)", fontSize: 13 }}>No mechanisms found.</div>}
      <Pager page={pageNo} total={list.data?.length ?? 0} onPage={setPageNo} />
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {pageOf(list.data ?? [], pageNo).map((m) => (
          <div key={m.serialNumber} style={{ ...card, display: "flex", alignItems: "center", gap: 14, padding: 16, borderColor: selected.has(m.serialNumber) ? "var(--accent)" : "var(--border-soft)" }}>
          <input
            type="checkbox"
            checked={selected.has(m.serialNumber)}
            onChange={() => toggle(m.serialNumber)}
            aria-label={`Select ${m.serialNumber}`}
            title="Select for PDF"
            style={{ width: 28, height: 28, accentColor: "var(--accent)", flex: "none" }}
          />
          <Link
            to={topboxUrl(m.serialNumber)}
            style={{ flex: 1, minWidth: 0, color: "inherit", textDecoration: "none", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}
          >
            <div>
              <div className="mono" style={{ fontSize: 20, fontWeight: 700 }}>
                {m.serialNumber}
              </div>
              <div style={{ fontSize: 12.5, color: "var(--text-3)", marginTop: 4 }}>
                {m.visits} visit{m.visits === 1 ? "" : "s"} ({m.completedVisits ?? 0} finished) · latest: {m.last.typeName}{m.last.firstCheckAt ? ` · 1st check ${stamp(m.last.firstCheckAt)}` : ""}
              </div>
            </div>
            {m.atClient ? (
              <span style={chip("accent")}>Complete</span>
            ) : (
              <span style={chip("warn")}>In progress · {m.last.firstCheckAt ? "1st check done" : "waiting for 1st check"}</span>
            )}
          </Link>
          </div>
        ))}
      </div>
      <Pager page={pageNo} total={list.data?.length ?? 0} onPage={setPageNo} />
    </div>
  );
}
