import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import type { Part, Signoff, TemplateInput, TemplateRow } from "@biosite-signoff/shared";
import { createTemplate, getTemplate, listParts, updateTemplate } from "../lib/api.js";
import { mutateOrQueue } from "../lib/offlineQueue.js";
import { withSaving } from "../lib/savingStatus.js";
import { openPdf } from "../lib/pdfLazy.js";
import { useMe } from "../lib/meContext.js";
import { SetupSubNav } from "../components/SetupSubNav.js";
import { card, errorBox, errorMessage, ghost, h1, iconButton, infoBox, input, label, page, primary } from "../lib/ui.js";

const uid = () => crypto.randomUUID();

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
}

const blank = (): TemplateInput => ({
  name: "",
  documentRef: "",
  documentId: "",
  serialLabel: "Serial Number",
  checks: [
    { id: uid(), label: "1st Check" },
    { id: uid(), label: "2nd Check" },
  ],
  rows: [{ id: uid(), kind: "item", text: "", bold: false, indent: false }],
  signRowEnabled: true,
  signRowLabel: "Sign and date here",
  distinctSigners: false,
  partIds: [],
});

function move<T>(list: T[], i: number, by: number): T[] {
  const j = i + by;
  if (j < 0 || j >= list.length) return list;
  const next = [...list];
  [next[i], next[j]] = [next[j]!, next[i]!];
  return next;
}

export function TemplateEditorPage() {
  const { id = "new" } = useParams();
  const isNew = id === "new";
  const navigate = useNavigate();
  const me = useMe();
  const [draft, setDraft] = useState<TemplateInput | null>(isNew ? blank() : null);
  const [parts, setParts] = useState<Part[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [bulk, setBulk] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void listParts().then(setParts, () => {});
    if (!isNew) {
      getTemplate(id).then(
        ({ id: _i, createdAt: _c, updatedAt: _u, ...rest }) => setDraft(rest),
        (err) => setError(errorMessage(err)),
      );
    }
  }, [id, isNew]);

  if (!draft) return <div style={page}>{error ? <div style={errorBox}>{error}</div> : <span style={{ color: "var(--text-3)", fontSize: 13 }}>Loading…</span>}</div>;

  const set = (patch: Partial<TemplateInput>) => {
    setSaved(null);
    setDraft((d) => (d ? { ...d, ...patch } : d));
  };
  const setRow = (i: number, patch: Partial<TemplateRow>) => set({ rows: draft.rows.map((r, j) => (j === i ? { ...r, ...patch } : r)) });

  function addBulk() {
    const lines = bulk
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    if (!lines.length) return;
    // A line ending in ":" becomes a section heading, like "Security red paint on:" on the paper form.
    const rows = lines.map<TemplateRow>((text) => ({ id: uid(), kind: text.endsWith(":") ? "section" : "item", text, bold: text.endsWith(":"), indent: false }));
    set({ rows: [...draft!.rows.filter((r) => r.text.trim()), ...rows] });
    setBulk("");
  }

  async function save() {
    if (!draft) return;
    const clean = { ...draft, rows: draft.rows.filter((r) => r.text.trim()) };
    setSaving(true);
    setError(null);
    try {
      if (isNew) {
        const templateId = uid();
        await withSaving(() => mutateOrQueue({ kind: "createTemplate", templateId, input: clean }, () => createTemplate(templateId, clean)));
        navigate(`/setup/templates/${templateId}`, { replace: true });
      } else {
        await withSaving(() => mutateOrQueue({ kind: "updateTemplate", templateId: id, input: clean }, () => updateTemplate(id, clean)));
        setDraft(clean);
      }
      setSaved("Saved.");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  function preview() {
    if (!draft) return;
    const now = new Date().toISOString();
    const sample: Signoff = {
      id: "preview",
      number: "SO-PREVIEW",
      templateId: "preview",
      template: { ...draft, id: "preview", createdAt: now, updatedAt: now },
      serialNumber: "SAMPLE-0001",
      mode: "new",
      notes: "",
      marks: [],
      signatures: [],
      parts: [],
      createdBy: me.userId,
      createdByName: me.name,
      createdAt: now,
      updatedAt: now,
    };
    void openPdf([sample, { ...sample, serialNumber: "SAMPLE-0002" }]);
  }

  return (
    <div style={page}>
      <h1 style={h1}>Setup</h1>
      <SetupSubNav />
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
        <div style={{ fontSize: 16, fontWeight: 700 }}>{isNew ? "New template" : `Edit: ${draft.name || "template"}`}</div>
        <div style={{ display: "flex", gap: 8 }}>
          <button style={{ ...ghost, height: 38 }} onClick={preview}>
            Preview PDF
          </button>
          <button style={primary} onClick={() => void save()} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
      {!isNew && <div style={infoBox}>Changes apply to new sign-offs only — every sign-off already started keeps the version of this template it began with.</div>}
      {error && <div style={errorBox}>{error}</div>}
      {saved && <div style={infoBox}>{saved}</div>}

      <section style={{ ...card, marginBottom: 12, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
        <Field label="Template name" value={draft.name} onChange={(name) => set({ name })} placeholder="Mechanism Checklist" />
        <Field label="Document id (footer)" value={draft.documentId} onChange={(documentId) => set({ documentId })} placeholder="PA-DOC-189-006" />
        <Field label="Document reference (header)" value={draft.documentRef} onChange={(documentRef) => set({ documentRef })} placeholder="PA-DOC-189, revision 6, released 23-May-2019" />
        <Field label="Identifier label" value={draft.serialLabel} onChange={(serialLabel) => set({ serialLabel })} placeholder="Serial Number" />
      </section>

      <section style={{ ...card, marginBottom: 12 }}>
        <div style={{ fontWeight: 700, marginBottom: 8 }}>Check columns</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {draft.checks.map((c, i) => (
            <div key={c.id} style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <input value={c.label} onChange={(e) => set({ checks: draft.checks.map((x) => (x.id === c.id ? { ...x, label: e.target.value } : x)) })} style={input} />
              <button style={iconButton} onClick={() => set({ checks: move(draft.checks, i, -1) })} aria-label="Move left">
                ↑
              </button>
              <button style={iconButton} onClick={() => set({ checks: move(draft.checks, i, 1) })} aria-label="Move right">
                ↓
              </button>
              <button style={{ ...iconButton, color: "var(--danger)" }} disabled={draft.checks.length <= 1} onClick={() => set({ checks: draft.checks.filter((x) => x.id !== c.id) })} aria-label="Remove">
                ✕
              </button>
            </div>
          ))}
        </div>
        <button style={{ ...ghost, marginTop: 8 }} disabled={draft.checks.length >= 8} onClick={() => set({ checks: [...draft.checks, { id: uid(), label: `${ordinal(draft.checks.length + 1)} Check` }] })}>
          + Add check
        </button>
      </section>

      <section style={{ ...card, marginBottom: 12 }}>
        <div style={{ fontWeight: 700, marginBottom: 4 }}>Items</div>
        <div style={{ fontSize: 12.5, color: "var(--text-3)", marginBottom: 10 }}>
          <b>Item</b> rows get a mark in every check column. <b>Section</b> rows are headings (e.g. "Security red paint on:") with no mark. <b>B</b> = bold, <b>⇥</b> = indent under the section.
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {draft.rows.map((r, i) => (
            <div key={r.id} style={{ display: "flex", gap: 6, alignItems: "center", paddingLeft: r.indent ? 18 : 0 }}>
              <span className="mono" style={{ fontSize: 11, color: "var(--text-4)", width: 20, textAlign: "right", flex: "none" }}>
                {i + 1}
              </span>
              <select value={r.kind} onChange={(e) => setRow(i, { kind: e.target.value as TemplateRow["kind"] })} style={{ ...input, width: 92, flex: "none", padding: "0 4px" }}>
                <option value="item">Item</option>
                <option value="section">Section</option>
              </select>
              <input value={r.text} onChange={(e) => setRow(i, { text: e.target.value })} style={{ ...input, fontWeight: r.bold ? 700 : 400, minWidth: 0 }} placeholder={r.kind === "section" ? "Section heading" : "What to check"} />
              <button style={{ ...iconButton, fontWeight: 900, color: r.bold ? "var(--accent)" : "var(--text-3)" }} onClick={() => setRow(i, { bold: !r.bold })} aria-label="Bold">
                B
              </button>
              <button style={{ ...iconButton, color: r.indent ? "var(--accent)" : "var(--text-3)" }} onClick={() => setRow(i, { indent: !r.indent })} aria-label="Indent">
                ⇥
              </button>
              <button style={iconButton} onClick={() => set({ rows: move(draft.rows, i, -1) })} aria-label="Move up">
                ↑
              </button>
              <button style={iconButton} onClick={() => set({ rows: move(draft.rows, i, 1) })} aria-label="Move down">
                ↓
              </button>
              <button style={{ ...iconButton, color: "var(--danger)" }} onClick={() => set({ rows: draft.rows.filter((x) => x.id !== r.id) })} aria-label="Remove">
                ✕
              </button>
            </div>
          ))}
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          <button style={ghost} onClick={() => set({ rows: [...draft.rows, { id: uid(), kind: "item", text: "", bold: false, indent: false }] })}>
            + Add item
          </button>
          <button style={ghost} onClick={() => set({ rows: [...draft.rows, { id: uid(), kind: "section", text: "", bold: true, indent: false }] })}>
            + Add section
          </button>
        </div>
        <details style={{ marginTop: 12 }}>
          <summary style={{ fontSize: 12.5, color: "var(--text-2)", cursor: "pointer" }}>Paste many items at once</summary>
          <textarea value={bulk} onChange={(e) => setBulk(e.target.value)} rows={6} placeholder={"One item per line.\nA line ending with ':' becomes a section."} style={{ ...input, height: "auto", padding: 10, marginTop: 8 }} />
          <button style={{ ...ghost, marginTop: 6 }} onClick={addBulk}>
            Add lines
          </button>
        </details>
      </section>

      <section style={{ ...card, marginBottom: 12, display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ fontWeight: 700 }}>Signing</div>
        <Toggle checked={draft.signRowEnabled} onChange={(signRowEnabled) => set({ signRowEnabled })} text='"Sign and date here" row — each check column gets its own signature and date' />
        {draft.signRowEnabled && <Field label="Sign row label" value={draft.signRowLabel} onChange={(signRowLabel) => set({ signRowLabel })} />}
        {draft.signRowEnabled && <Toggle checked={draft.distinctSigners} onChange={(distinctSigners) => set({ distinctSigners })} text="Each check must be signed by a different person" />}
      </section>

      <section style={{ ...card, marginBottom: 12 }}>
        <div style={{ fontWeight: 700, marginBottom: 4 }}>Replaceable parts (service only)</div>
        <div style={{ fontSize: 12.5, color: "var(--text-3)", marginBottom: 10 }}>
          Tick the parts an operator may mark as replaced on a <b>service</b> sign-off of this template. Leave all unticked if this mechanism never gets parts replaced. Manage the list under{" "}
          <Link to="/setup/parts" style={{ color: "var(--accent)" }}>
            Parts
          </Link>
          .
        </div>
        {parts.length === 0 && <div style={{ fontSize: 13, color: "var(--text-4)" }}>No parts defined yet.</div>}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 6 }}>
          {parts.map((p) => (
            <Toggle
              key={p.id}
              checked={draft.partIds.includes(p.id)}
              onChange={(on) => set({ partIds: on ? [...draft.partIds, p.id] : draft.partIds.filter((x) => x !== p.id) })}
              text={
                <>
                  <span className="mono" style={{ color: "var(--text-3)", fontSize: 12 }}>
                    {p.partNumber}
                  </span>{" "}
                  {p.name}
                </>
              }
            />
          ))}
        </div>
      </section>

      <button style={{ ...primary, width: "100%", height: 46 }} onClick={() => void save()} disabled={saving}>
        {saving ? "Saving…" : "Save template"}
      </button>
    </div>
  );
}

function Field({ label: text, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <span className="mono" style={label}>
        {text}
      </span>
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} style={input} />
    </label>
  );
}

function Toggle({ checked, onChange, text }: { checked: boolean; onChange: (v: boolean) => void; text: React.ReactNode }) {
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13.5, cursor: "pointer" }}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} style={{ width: 18, height: 18, accentColor: "var(--accent)", flex: "none" }} />
      <span>{text}</span>
    </label>
  );
}
