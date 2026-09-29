import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import type { Template } from "@biosite-signoff/shared";
import { useSignoffTypes } from "../lib/signoffTypes.js";
import { createSignoff, listTemplates } from "../lib/api.js";
import { useData } from "../lib/useData.js";
import { useMe } from "../lib/meContext.js";
import { mutateOrQueue } from "../lib/offlineQueue.js";
import { withSaving } from "../lib/savingStatus.js";
import { cacheSignoff } from "../lib/signoffCache.js";
import { draftSignoff } from "../lib/localSignoff.js";
import { card, errorBox, errorMessage, h1, hint, input, label, page, primary } from "../lib/ui.js";

export function NewSignoffPage() {
  const navigate = useNavigate();
  const me = useMe();
  const templates = useData<Template[]>(listTemplates);
  const [templateId, setTemplateId] = useState("");
  const types = useSignoffTypes();
  const [typeId, setTypeId] = useState("");
  const type = types.find((t) => t.id === typeId) ?? types[0];
  const [serial, setSerial] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const chosen = templates.data?.find((t) => t.id === (templateId || templates.data?.[0]?.id));

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!chosen || !type || !serial.trim()) return;
    setBusy(true);
    setError(null);
    const input = { id: crypto.randomUUID(), templateId: chosen.id, serialNumber: serial.trim(), typeId: type.id };
    try {
      const outcome = await withSaving(() => mutateOrQueue({ kind: "createSignoff", input }, () => createSignoff(input)));
      cacheSignoff(outcome.synced ? outcome.result : draftSignoff(input, type, chosen, me));
      navigate(`/signoffs/${input.id}`, { replace: true });
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <div style={{ ...page, maxWidth: 560 }}>
      <h1 style={h1}>New sign-off</h1>
      <p style={hint}>Pick the checklist and the type, then enter the serial number.</p>
      {(error || templates.error) && <div style={errorBox}>{error ?? templates.error}</div>}
      {templates.data?.length === 0 && <div style={errorBox}>No templates yet — an admin needs to create one under Setup → Templates.</div>}

      <form onSubmit={submit} style={{ ...card, display: "flex", flexDirection: "column", gap: 16 }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span className="mono" style={label}>
            Checklist
          </span>
          <select value={chosen?.id ?? ""} onChange={(e) => setTemplateId(e.target.value)} style={input}>
            {templates.data?.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
                {t.documentId ? ` — ${t.documentId}` : ""}
              </option>
            ))}
          </select>
        </label>

        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span className="mono" style={label}>
            Type
          </span>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 8 }}>
            {types.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTypeId(t.id)}
                style={{
                  minHeight: 72,
                  borderRadius: "var(--radius-control)",
                  border: `1px solid ${type?.id === t.id ? "var(--accent)" : "var(--border)"}`,
                  background: type?.id === t.id ? "var(--accent-wash)" : "var(--bg-deep)",
                  color: type?.id === t.id ? "var(--accent-wash-text)" : "var(--text-2)",
                  cursor: "pointer",
                  textAlign: "left",
                  padding: "8px 12px",
                }}
              >
                <div style={{ fontWeight: 700, fontSize: 14 }}>{t.name}</div>
                {t.description && <div style={{ fontSize: 11.5, opacity: 0.8 }}>{t.description}</div>}
              </button>
            ))}
          </div>
        </div>

        <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span className="mono" style={label}>
            {chosen?.serialLabel ?? "Serial Number"}
          </span>
          <input value={serial} onChange={(e) => setSerial(e.target.value)} autoFocus style={{ ...input, height: 56, fontSize: 18 }} className="mono" autoCapitalize="characters" />
        </label>

        <button type="submit" disabled={busy || !chosen || !serial.trim()} style={{ ...primary, height: 58, fontSize: 15, opacity: busy || !chosen || !serial.trim() ? 0.6 : 1 }}>
          {busy ? "Creating…" : "Start sign-off"}
        </button>
      </form>
    </div>
  );
}
