import { useEffect, useState, type FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { allowsRefurbishedR, departedAt, mechanismKey, oncePerTopboxBlock, refurbishedRBlock, type Signoff, type SignoffType } from "@biosite-signoff/shared";
import { getVisits } from "../lib/api.js";
import { stamp, topboxUrl } from "../lib/format.js";
import type { Template } from "@biosite-signoff/shared";
import { useSignoffTypes } from "../lib/signoffTypes.js";
import { createSignoff, listTemplates } from "../lib/api.js";
import { useData } from "../lib/useData.js";
import { useMe } from "../lib/meContext.js";
import { mutateOrQueue } from "../lib/offlineQueue.js";
import { withSaving } from "../lib/savingStatus.js";
import { cacheSignoff } from "../lib/signoffCache.js";
import { draftSignoff } from "../lib/localSignoff.js";
import { card, errorBox, errorMessage, ghost, h1, hint, input, label, page, primary } from "../lib/ui.js";

export function NewSignoffPage() {
  const navigate = useNavigate();
  // Prefilled from the home tabs ("+ New Service") and "Mechanism is back — start new visit".
  const [params] = useSearchParams();
  const me = useMe();
  const templates = useData<Template[]>(listTemplates);
  const [templateId, setTemplateId] = useState(params.get("templateId") ?? "");
  const types = useSignoffTypes();
  const [typeId, setTypeId] = useState(params.get("typeId") ?? "");
  const [serial, setSerial] = useState(params.get("serial") ?? "");
  // Returning mechanism? Show its previous visits so nobody starts a duplicate while it's still in.
  const [previous, setPrevious] = useState<Signoff[] | null>(null);
  useEffect(() => {
    const s = serial.trim();
    if (s.length < 2) return setPrevious(null);
    const t = setTimeout(() => void getVisits(s).then(setPrevious, () => setPrevious(null)), 300);
    return () => clearTimeout(t);
  }, [serial]);
  const lastVisit = previous?.[previous.length - 1];
  const stillIn = lastVisit && !departedAt(lastVisit);
  // "Only once per TopBox" types (Setup → Types, e.g. New) can't be picked again for a TopBox that
  // already had one. Unless someone picks a type themselves, a returning serial defaults to the
  // first type still allowed for it.
  const blockOf = (t: SignoffType) => (previous && previous.length > 0 && serial.trim() ? oncePerTopboxBlock(serial.trim(), previous, t, types) : null);
  const returning = Boolean(previous && previous.length > 0 && !stillIn);
  const type = types.find((t) => t.id === typeId) ?? (returning ? types.find((t) => !blockOf(t)) : undefined) ?? types[0];
  const key = mechanismKey(serial);
  const hasR = serial.trim() !== "" && key !== serial.trim().toUpperCase();
  // The refurbished R only on the types that allow it (Setup → Types).
  const typeBlock = type ? (blockOf(type) ?? refurbishedRBlock(serial, type)) : null;
  const canAddR = Boolean(type && allowsRefurbishedR(type)) && /\d$/.test(key) && !hasR;
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const chosen = templates.data?.find((t) => t.id === (templateId || templates.data?.[0]?.id));

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!chosen || !type || !serial.trim() || typeBlock) return;
    setBusy(true);
    setError(null);
    const input = { id: crypto.randomUUID(), templateId: chosen.id, serialNumber: serial.trim(), typeId: type.id };
    try {
      const outcome = await withSaving(() => mutateOrQueue({ kind: "createSignoff", input }, () => createSignoff(input)));
      cacheSignoff(outcome.synced ? outcome.result : draftSignoff(input, type, chosen, me));
      navigate(topboxUrl(input.serialNumber, input.id), { replace: true });
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
        <label style={{ display: (templates.data?.length ?? 0) > 1 ? "flex" : "none", flexDirection: "column", gap: 6 }}>
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
                title={blockOf(t) ?? undefined}
                style={{
                  opacity: blockOf(t) && type?.id !== t.id ? 0.4 : 1,
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
                {blockOf(t) && <div style={{ fontSize: 11, opacity: 0.8, marginTop: 2 }}>already used for this TopBox</div>}
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
        {(canAddR || hasR) && (
          <button type="button" onClick={() => setSerial(hasR ? serial.trim().slice(0, -1) : `${serial.trim()}R`)} style={{ ...ghost, height: 48, alignSelf: "flex-start" }} title="R = refurbished">
            {hasR ? "Remove R" : "+R refurbished"}
          </button>
        )}

        {previous && previous.length > 0 && lastVisit && (
          <div style={{ borderLeft: `3px solid ${stillIn ? "var(--warn)" : "var(--accent)"}`, background: stillIn ? "var(--bg-deep)" : "var(--accent-wash)", borderRadius: "var(--radius-callout)", padding: "10px 12px", fontSize: 13.5 }}>
            {stillIn ? (
              <>
                <b>{lastVisit.serialNumber}</b> is still in the workshop (visit {previous.length}) —{" "}
                <a href={topboxUrl(lastVisit.serialNumber, lastVisit.id)} style={{ color: "var(--accent)", fontWeight: 700 }}>
                  open it instead
                </a>
                .
              </>
            ) : (
              <>
                Returning mechanism — this will be visit <b>{previous.length + 1}</b>. Last left {stamp(departedAt(lastVisit))}. Type set to <b>{type?.name}</b>{canAddR ? " — add R if it was refurbished" : ""}.
              </>
            )}
          </div>
        )}
        {typeBlock && <div style={{ ...errorBox, marginBottom: 0 }}>{typeBlock}</div>}
        <button type="submit" disabled={busy || !chosen || !serial.trim() || Boolean(typeBlock)} style={{ ...primary, height: 58, fontSize: 15, opacity: busy || !chosen || !serial.trim() || typeBlock ? 0.6 : 1 }}>
          {busy ? "Creating…" : "Start sign-off"}
        </button>
      </form>
    </div>
  );
}
