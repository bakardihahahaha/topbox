import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { signoffStatus, type SignoffSummary, type Template } from "@biosite-signoff/shared";
import { getSignoffs, listTemplates } from "../lib/api.js";
import { listSignoffsOfflineAware } from "../lib/offlineList.js";
import { useData } from "../lib/useData.js";
import { useMe } from "../lib/meContext.js";
import { downloadPdf } from "../lib/pdfLazy.js";
import { useSignoffTypes } from "../lib/signoffTypes.js";
import { topboxUrl } from "../lib/format.js";
import { card, chip, errorBox, infoBox, errorMessage, ghost, h1, input, page, primary } from "../lib/ui.js";

const PAGE_SIZE = 50;

export function SignoffsListPage() {
  const navigate = useNavigate();
  const me = useMe();
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [status, setStatus] = useState<"" | "draft" | "complete">("");
  const [typeId, setTypeId] = useState("");
  const types = useSignoffTypes();
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q), 250);
    return () => clearTimeout(t);
  }, [q]);

  const templates = useData<Template[]>(listTemplates);
  const list = useData(() => listSignoffsOfflineAware({ q: debouncedQ, templateId, status: status || undefined, typeId: typeId || undefined, limit }), [debouncedQ, templateId, status, typeId, limit]);

  function toggle(id: string) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function generate() {
    setBusy(true);
    setPdfError(null);
    try {
      // Printed in SO-number order, oldest first — the order they'd sit in a paper file.
      // Only finished sign-offs (every check signed) go into a PDF — anything else stops it.
      const full = await getSignoffs([...selected]);
      const unfinished = full.filter((s) => signoffStatus(s) !== "complete");
      if (unfinished.length > 0) {
        throw new Error(`Can't create the PDF — not every check is signed on ${unfinished.map((s) => s.serialNumber).join(", ")}. Untick ${unfinished.length === 1 ? "it" : "them"} and try again.`);
      }
      full.sort((a, b) => a.number.localeCompare(b.number));
      await downloadPdf(full);
    } catch (err) {
      setPdfError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const items = list.data?.items ?? [];

  return (
    <div style={page}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 12 }}>
        <h1 style={h1}>Sign-offs</h1>
        {me.role !== "viewer" && (
          <button style={primary} onClick={() => navigate("/signoffs/new")}>
            + New sign-off
          </button>
        )}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 8, marginBottom: 12 }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search serial number" style={{ ...input, gridColumn: "1 / -1" }} />
        {(templates.data?.length ?? 0) > 1 && (
          <select value={templateId} onChange={(e) => setTemplateId(e.target.value)} style={input}>
            <option value="">All templates</option>
            {templates.data?.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        )}
        <select value={status} onChange={(e) => setStatus(e.target.value as typeof status)} style={input}>
          <option value="">Any status</option>
          <option value="draft">In progress</option>
          <option value="complete">Complete</option>
        </select>
        <select value={typeId} onChange={(e) => setTypeId(e.target.value)} style={input}>
          <option value="">All types</option>
          {types.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </div>

      {selected.size > 0 && (
        <div style={{ ...card, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 12, position: "sticky", top: 0, zIndex: 5 }}>
          <span style={{ fontSize: 13 }}>{selected.size} selected</span>
          <div style={{ display: "flex", gap: 8 }}>
            <button style={ghost} onClick={() => setSelected(new Set())}>
              Clear
            </button>
            <button style={primary} onClick={generate} disabled={busy}>
              {busy ? "Generating…" : "Generate PDF"}
            </button>
          </div>
        </div>
      )}

      {(list.error || pdfError) && <div style={errorBox}>{pdfError ?? list.error}</div>}
      {list.data?.offline && <div style={infoBox}>No connection — showing the list as last seen on this device. Changes you make are saved here and sync automatically.</div>}
      {!list.data && !list.error && <div style={{ color: "var(--text-3)", fontSize: 13 }}>Loading…</div>}
      {list.data && items.length === 0 && <div style={{ color: "var(--text-4)", fontSize: 13 }}>No sign-offs match.</div>}

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {items.map((s) => (
          <Row key={s.id} s={s} selected={selected.has(s.id)} onToggle={() => toggle(s.id)} />
        ))}
      </div>

      {list.data && list.data.total > items.length && (
        <button style={{ ...ghost, marginTop: 12, width: "100%" }} onClick={() => setLimit((l) => l + PAGE_SIZE)}>
          Load more ({list.data.total - items.length} more)
        </button>
      )}
    </div>
  );
}

function Row({ s, selected, onToggle }: { s: SignoffSummary; selected: boolean; onToggle: () => void }) {
  return (
    <div style={{ ...card, padding: "14px 14px", display: "flex", alignItems: "center", gap: 14, borderColor: selected ? "var(--accent)" : "var(--border-soft)" }}>
      {/* Selecting is for the PDF — only complete sign-offs can be printed. */}
      <input
        type="checkbox"
        checked={selected}
        disabled={s.status !== "complete"}
        onChange={onToggle}
        aria-label={`Select ${s.serialNumber}`}
        title={s.status === "complete" ? "Select for PDF" : "PDF available once every check is signed"}
        style={{ width: 28, height: 28, accentColor: "var(--accent)", flex: "none", opacity: s.status === "complete" ? 1 : 0.3 }}
      />
      <Link to={topboxUrl(s.serialNumber, s.id)} style={{ flex: 1, minWidth: 0, color: "inherit", textDecoration: "none" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span className="mono" style={{ fontSize: 17, fontWeight: 700 }}>{s.serialNumber}</span>
          <span style={chip(s.status === "complete" ? "accent" : "warn")}>{s.status === "complete" ? "Complete" : `In progress ${s.progress}`}</span>
          <span style={chip("muted")}>{s.typeName}</span>
        </div>
      </Link>
    </div>
  );
}
