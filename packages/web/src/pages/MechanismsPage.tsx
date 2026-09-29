import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { MechanismSummary } from "@biosite-signoff/shared";
import { listMechanisms } from "../lib/api.js";
import { useData } from "../lib/useData.js";
import { daysBetween, localStamp, stamp, topboxUrl } from "../lib/format.js";
import { card, chip, errorBox, errorMessage, ghost, h1, hint, infoBox, input, page, primary } from "../lib/ui.js";
import { planMechanismPdf, type PdfScope } from "../lib/mechanismPdf.js";
import { downloadPdf } from "../lib/pdfLazy.js";

/** Every mechanism (serial number) and where it is now: in the workshop or out at a client. */
export function MechanismsPage() {
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);
  const list = useData<MechanismSummary[]>(() => listMechanisms(debounced || undefined), [debounced]);
  const now = new Date();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [pdfNotes, setPdfNotes] = useState<string[]>([]);

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
    setPdfNotes([]);
    try {
      const plan = await planMechanismPdf([...selected], scope);
      if (plan.missing.length > 0) {
        throw new Error(`Can't create the PDF — ${plan.missing.join(", ")} ${plan.missing.length === 1 ? "has" : "have"} no finished sign-off yet (every check must be signed). Untick ${plan.missing.length === 1 ? "it" : "them"} and try again.`);
      }
      await downloadPdf(plan.signoffs);
      setPdfNotes(plan.notes);
    } catch (err) {
      setPdfError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={page}>
      <h1 style={h1}>Mechanisms</h1>
      <p style={hint}>Each serial number with all its visits: when it arrived, when each check was done and when it left again. Tap one for its full history.</p>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search serial number" style={{ ...input, height: 52, fontSize: 16, marginBottom: 12 }} />
      {selected.size > 0 && (
        <div style={{ ...card, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 12, position: "sticky", top: 0, zIndex: 5, flexWrap: "wrap" }}>
          <span style={{ fontSize: 13 }}>{selected.size} TopBox{selected.size === 1 ? "" : "es"} selected</span>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button style={ghost} onClick={() => setSelected(new Set())} disabled={busy}>
              Clear
            </button>
            <button style={primary} onClick={() => void generate("latest")} disabled={busy} title="Each TopBox's most recent finished visit">
              {busy ? "Generating…" : "PDF — last finished visit"}
            </button>
            <button style={{ ...ghost, borderColor: "var(--accent)", color: "var(--accent)" }} onClick={() => void generate("all")} disabled={busy} title="Every finished visit of each TopBox — its whole history">
              PDF — all finished visits
            </button>
          </div>
        </div>
      )}
      {pdfError && <div style={errorBox}>{pdfError}</div>}
      {pdfNotes.length > 0 && (
        <div style={infoBox}>
          PDF downloaded. Not included:
          {pdfNotes.map((n) => (
            <div key={n}>• {n}</div>
          ))}
        </div>
      )}
      {list.error && <div style={errorBox}>{list.error}</div>}
      {list.data?.length === 0 && <div style={{ color: "var(--text-4)", fontSize: 13 }}>No mechanisms found.</div>}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {list.data?.map((m) => (
          <div key={m.serialNumber} style={{ ...card, display: "flex", alignItems: "center", gap: 14, padding: 16, borderColor: selected.has(m.serialNumber) ? "var(--accent)" : "var(--border-soft)" }}>
          {/* Selecting is for the PDF — only TopBoxes with at least one finished visit. */}
          <input
            type="checkbox"
            checked={selected.has(m.serialNumber)}
            disabled={(m.completedVisits ?? 0) === 0}
            onChange={() => toggle(m.serialNumber)}
            aria-label={`Select ${m.serialNumber}`}
            title={(m.completedVisits ?? 0) > 0 ? `Select for PDF (${m.completedVisits} finished visit${m.completedVisits === 1 ? "" : "s"})` : "No finished visit yet — nothing to print"}
            style={{ width: 28, height: 28, accentColor: "var(--accent)", flex: "none", opacity: (m.completedVisits ?? 0) > 0 ? 1 : 0.3 }}
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
                {m.visits} visit{m.visits === 1 ? "" : "s"} ({m.completedVisits ?? 0} finished) · last arrived {localStamp(m.last.arrivedAt)} · {m.last.typeName}
              </div>
            </div>
            {m.atClient ? (
              <span style={chip("accent")}>
                At client · left {stamp(m.last.departedAt)}
                {m.last.departedAt ? ` (${daysBetween(m.last.departedAt.replace(" ", "T"), now)} d)` : ""}
              </span>
            ) : (
              <span style={chip("warn")}>In workshop · {m.last.firstCheckAt ? "1st check done" : "waiting for 1st check"}</span>
            )}
          </Link>
          </div>
        ))}
      </div>
    </div>
  );
}
