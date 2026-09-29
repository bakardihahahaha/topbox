import { useEffect, useState } from "react";
import { DEFAULT_DOCUMENT_SETTINGS, type DocumentSettings, type Signoff, type Template } from "@biosite-signoff/shared";
import { getDocumentSettings, listTemplates, saveDocumentSettings, updateTemplate } from "../lib/api.js";
import { mutateOrQueue } from "../lib/offlineQueue.js";
import { withSaving } from "../lib/savingStatus.js";
import { mechanismPreview } from "../lib/preview.js";
import { openPdf } from "../lib/pdfLazy.js";
import { useMe } from "../lib/meContext.js";
import { SetupSubNav } from "../components/SetupSubNav.js";
import { card, errorBox, errorMessage, ghost, h1, hint, infoBox, input, label, page, primary } from "../lib/ui.js";

/** Shrinks an uploaded logo to at most 600x160 px so it stays small (it's stored in the database
 * and mirrored to one Google Sheets cell) while staying sharp in print. */
async function resizeLogo(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const scale = Math.min(1, 600 / img.naturalWidth, 160 / img.naturalHeight);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
    let out = canvas.toDataURL("image/png");
    // Photos/gradients compress badly as PNG — fall back to JPEG on white.
    if (out.length > 44_000) {
      const ctx = canvas.getContext("2d")!;
      ctx.globalCompositeOperation = "destination-over";
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      for (const q of [0.9, 0.8, 0.65, 0.5]) {
        out = canvas.toDataURL("image/jpeg", q);
        if (out.length <= 44_000) break;
      }
    }
    if (out.length > 44_000) throw new Error("This image is too detailed — try a simpler logo file.");
    return out;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function SetupDocumentPage() {
  const me = useMe();
  const [s, setS] = useState<DocumentSettings | null>(null);
  const [templates, setTemplates] = useState<Template[]>([]);
  /** Edited per-template fields, keyed by template id — only changed templates are saved. */
  const [docFields, setDocFields] = useState<Record<string, Pick<Template, "name" | "documentRef" | "documentId">>>({});
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getDocumentSettings().then(setS, (err) => setError(errorMessage(err)));
    void listTemplates().then(setTemplates, () => {});
  }, []);

  if (!s) return <div style={page}>{error ? <div style={errorBox}>{error}</div> : <span style={{ color: "var(--text-3)", fontSize: 13 }}>Loading…</span>}</div>;

  const set = (patch: Partial<DocumentSettings>) => {
    setSaved(false);
    setS({ ...s, ...patch });
  };

  async function save() {
    setSaving(true);
    setError(null);
    try {
      for (const t of templates) {
        const f = docFields[t.id];
        if (!f || (f.name === t.name && f.documentRef === t.documentRef && f.documentId === t.documentId)) continue;
        const { id, createdAt: _c, updatedAt: _u, ...rest } = t;
        const input = { ...rest, ...f };
        await withSaving(() => mutateOrQueue({ kind: "updateTemplate", templateId: id, input }, () => updateTemplate(id, input)));
      }
      setTemplates(templates.map((t) => ({ ...t, ...docFields[t.id] })));
      setS(await saveDocumentSettings(s!));
      setSaved(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  const fieldsOf = (t: Template) => docFields[t.id] ?? { name: t.name, documentRef: t.documentRef, documentId: t.documentId };
  const setField = (t: Template, patch: Partial<Pick<Template, "name" | "documentRef" | "documentId">>) => {
    setSaved(false);
    setDocFields((d) => ({ ...d, [t.id]: { ...fieldsOf(t), ...patch } }));
  };

  function preview() {
    const first = templates[0];
    const sample: Signoff = mechanismPreview(first ? { ...first, ...fieldsOf(first) } : undefined, me);
    void openPdf([sample], s!);
  }

  return (
    <div style={page}>
      <h1 style={h1}>Setup</h1>
      <SetupSubNav />
      <p style={hint}>
        Everything printed on the PDF around the checklist: logo, company name and address (top right), footer — and, per checklist, its title, the document reference in the header
        and the document id in the footer.
      </p>
      {error && <div style={errorBox}>{error}</div>}
      {saved && <div style={infoBox}>Saved — new PDFs use it straight away.</div>}

      <section style={{ ...card, marginBottom: 12, display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ fontWeight: 700 }}>Logo</div>
        {s.logoDataUrl ? (
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <img src={s.logoDataUrl} alt="Logo" style={{ maxHeight: 56, maxWidth: 240, background: "#fff", padding: 6, borderRadius: "var(--radius-control)" }} />
            <button style={ghost} onClick={() => set({ logoDataUrl: "" })}>
              Remove image (use text logo)
            </button>
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, maxWidth: 420 }}>
            <Field label="Logo text (red part)" value={s.logoTextAccent} onChange={(logoTextAccent) => set({ logoTextAccent })} />
            <Field label="Logo text (dark part)" value={s.logoText} onChange={(logoText) => set({ logoText })} />
          </div>
        )}
        <label style={{ ...ghost, height: "auto", padding: "8px 12px", display: "inline-flex", alignSelf: "flex-start", alignItems: "center" }}>
          {s.logoDataUrl ? "Replace logo image…" : "Upload logo image (PNG/JPG)…"}
          <input
            type="file"
            accept="image/png,image/jpeg"
            style={{ display: "none" }}
            onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (!f) return;
              try {
                set({ logoDataUrl: await resizeLogo(f) });
              } catch (err) {
                setError(errorMessage(err));
              }
            }}
          />
        </label>
      </section>

      <section style={{ ...card, marginBottom: 12, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 12 }}>
        <Field label="Company name" value={s.companyName} onChange={(companyName) => set({ companyName })} />
        <label style={{ display: "flex", flexDirection: "column", gap: 6, gridRow: "span 2" }}>
          <span className="mono" style={label}>
            Address (one line per line — street, city, postcode, tel, website…)
          </span>
          <textarea value={s.address} onChange={(e) => set({ address: e.target.value })} rows={6} style={{ ...input, height: "auto", padding: 10, lineHeight: 1.4 }} />
        </label>
        <Field label="Footer line" value={s.footerText} onChange={(footerText) => set({ footerText })} />
        <Field label="Label before the document id (footer)" value={s.documentIdLabel} onChange={(documentIdLabel) => set({ documentIdLabel })} />
      </section>

      <section style={{ ...card, marginBottom: 12, display: "flex", flexDirection: "column", gap: 12 }}>
        <div>
          <div style={{ fontWeight: 700 }}>Per checklist</div>
          <div style={{ fontSize: 12.5, color: "var(--text-3)", marginTop: 2 }}>
            Title above the table, reference in the page header (e.g. "PA-DOC-189, revision 6, released 23-May-2019") and id in the footer (e.g. "PA-DOC-189-006"). The same fields are in
            Templates → Edit.
          </div>
        </div>
        {templates.length === 0 && <div style={{ fontSize: 13, color: "var(--text-4)" }}>No templates yet.</div>}
        {templates.map((t) => {
          const f = fieldsOf(t);
          return (
            <div key={t.id} style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 8, paddingTop: 10, borderTop: "1px solid var(--border-soft)" }}>
              <Field label="Checklist title" value={f.name} onChange={(name) => setField(t, { name })} />
              <Field label="Document reference (header)" value={f.documentRef} onChange={(documentRef) => setField(t, { documentRef })} />
              <Field label="Document id (footer)" value={f.documentId} onChange={(documentId) => setField(t, { documentId })} />
            </div>
          );
        })}
      </section>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button style={primary} onClick={() => void save()} disabled={saving}>
          {saving ? "Saving…" : "Save"}
        </button>
        <button style={{ ...ghost, height: 38 }} onClick={preview}>
          Preview PDF
        </button>
        <button style={{ ...ghost, height: 38 }} onClick={() => set({ ...DEFAULT_DOCUMENT_SETTINGS })}>
          Reset to Biosite defaults
        </button>
      </div>
    </div>
  );
}

function Field({ label: text, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <span className="mono" style={label}>
        {text}
      </span>
      <input value={value} onChange={(e) => onChange(e.target.value)} style={input} />
    </label>
  );
}
