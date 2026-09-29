import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { allowedPartIds, isCheckFullyMarked, signoffProgress, signoffStatus, typeNameOf, type MarkValue, type Part, type Signoff, type Template, type TemplateCheck } from "@biosite-signoff/shared";
import * as api from "../lib/api.js";
import { ApiError } from "../lib/client.js";
import { useMe } from "../lib/meContext.js";
import { applyLocal } from "../lib/localSignoff.js";
import { mutateOrQueue, onQueueSynced, pendingFor, type QueuedAction } from "../lib/offlineQueue.js";
import { onDataChange } from "../lib/liveEvents.js";
import { withSaving } from "../lib/savingStatus.js";
import { cacheSignoff, cachedSignoff, forgetSignoff } from "../lib/signoffCache.js";
import { downloadPdf, openPdf } from "../lib/pdfLazy.js";
import { confirmDialog } from "../lib/confirmDialog.js";
import { SignatureImage } from "../components/SignaturePad.js";
import { SignModal } from "../components/SignModal.js";
import { useSignoffTypes } from "../lib/signoffTypes.js";
import { card, chip, danger, errorBox, errorMessage, formatDateTime, ghost, infoBox, input, label, page, primary } from "../lib/ui.js";

const NEXT: Record<string, MarkValue | null> = { none: "pass", pass: "fail", fail: "na", na: null };

/** One sign-off (one visit of a TopBox). Used on its own (/signoffs/:id, older links) and embedded
 * in the TopBox page (/signoff/:serial) above that serial's history. */
export function SignoffPage({ signoffId, embedded }: { signoffId?: string; embedded?: boolean } = {}) {
  const params = useParams();
  const id = signoffId ?? params.id ?? "";
  const me = useMe();
  const navigate = useNavigate();
  const [signoff, setSignoff] = useState<Signoff | null>(null);
  const [parts, setParts] = useState<Part[]>([]);
  const [liveTemplate, setLiveTemplate] = useState<Template | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [signing, setSigning] = useState<TemplateCheck | null>(null);
  const types = useSignoffTypes();
  const typesRef = useRef(types);
  typesRef.current = types;
  const inflight = useRef(0);
  const partsRef = useRef<Part[]>([]);
  partsRef.current = parts;

  const load = useCallback(async () => {
    if (inflight.current > 0) return; // a later refetch picks up the result once writes settle
    let base: Signoff | null = null;
    try {
      base = await api.getSignoff(id);
    } catch (err) {
      base = cachedSignoff(id);
      if (!base) {
        setLoadError(err instanceof ApiError && err.status === 404 ? "This sign-off doesn't exist (or was deleted)." : errorMessage(err));
        return;
      }
    }
    const pending = await pendingFor(id);
    const merged = pending.reduce((s, a) => applyLocal(s, a, me, partsRef.current, typesRef.current), base);
    if (inflight.current > 0) return;
    setSignoff(merged);
    cacheSignoff(merged);
    setLoadError(null);
  }, [id, me]);

  useEffect(() => {
    void load();
    void api.listParts().then(setParts, () => {});
    const a = onDataChange(() => void load());
    const b = onQueueSynced(() => void load());
    return () => {
      a();
      b();
    };
  }, [load]);

  // Current version of the checklist (the sign-off holds a frozen copy) — only for its
  // replaceable-parts list, so parts an admin enables later show up here too.
  const templateId = signoff?.templateId;
  useEffect(() => {
    if (!templateId) return;
    const fetchLive = () => {
      void api.getTemplate(templateId).then(setLiveTemplate, () => {});
      void api.listParts().then(setParts, () => {});
    };
    fetchLive();
    return onDataChange(fetchLive);
  }, [templateId]);

  async function mutate(action: QueuedAction, run: () => Promise<Signoff | unknown>) {
    setError(null);
    setSignoff((s) => {
      if (!s) return s;
      const next = applyLocal(s, action, me, parts, types);
      cacheSignoff(next);
      return next;
    });
    inflight.current++;
    try {
      const outcome = await withSaving(() => mutateOrQueue(action, run));
      if (outcome.synced && inflight.current === 1 && outcome.result && typeof outcome.result === "object" && "marks" in outcome.result) {
        setSignoff(outcome.result as Signoff);
        cacheSignoff(outcome.result as Signoff);
      }
    } catch (err) {
      // A real rejection (e.g. "mark every item before signing") — show it and put the screen
      // back to what the server actually holds.
      setError(errorMessage(err));
      inflight.current--;
      await load();
      return;
    }
    inflight.current--;
  }

  if (loadError) return <div style={page}><div style={errorBox}>{loadError}</div></div>;
  if (!signoff) return <div style={{ ...page, color: "var(--text-3)", fontSize: 13 }}>Loading…</div>;

  const s = signoff;
  const t = s.template;
  const status = signoffStatus(s);
  const { done, total } = signoffProgress(s);
  const signedBy = (checkId: string) => s.signatures.find((g) => g.checkId === checkId);
  const markOf = (rowId: string, checkId: string) => s.marks.find((m) => m.rowId === rowId && m.checkId === checkId)?.value;
  const allowed = allowedPartIds(t, liveTemplate);
  const allowedParts = allowed === "all" ? parts : parts.filter((p) => allowed.has(p.id));
  const showParts = s.mode === "service";

  function tap(rowId: string, checkId: string) {
    const value = NEXT[markOf(rowId, checkId) ?? "none"]!;
    void mutate({ kind: "setMark", id, rowId, checkId, value }, () => api.setMark(id, rowId, checkId, value));
  }

  // Records from before types existed have no typeId — match them by name, then by mode.
  const currentTypeId = s.typeId || types.find((x) => x.name === s.typeName)?.id || "";

  async function changeType(typeId: string) {
    const next = types.find((x) => x.id === typeId);
    if (!next || typeId === currentTypeId) return;
    if (!next.allowsParts && s.parts.length > 0) {
      setError(`Untick the replaced parts first — ${next.name} doesn't record replaced parts.`);
      return;
    }
    await mutate({ kind: "updateHeader", id, patch: { typeId } }, () => api.updateSignoffHeader(id, { typeId }));
  }

  async function remove() {
    if (!(await confirmDialog(`Delete ${s.number} (${s.serialNumber})? This can't be undone from the app.`, { confirmLabel: "Delete", danger: true }))) return;
    try {
      await withSaving(() => mutateOrQueue({ kind: "deleteSignoff", id }, () => api.deleteSignoff(id)));
      forgetSignoff(id);
      navigate("/signoffs", { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <div style={embedded ? undefined : page}>
      {/* Header */}
      <div style={{ ...card, marginBottom: 12, display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "flex-start" }}>
          <div style={{ minWidth: 0 }}>
            <div className="mono" style={{ fontSize: 11.5, color: "var(--text-3)" }}>
              {s.number} · {t.documentId || t.documentRef || "—"}
            </div>
            <div style={{ fontSize: 18, fontWeight: 700, marginTop: 2 }}>{t.name}</div>
            <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
              <span style={chip(status === "complete" ? "accent" : "warn")}>{status === "complete" ? "Complete" : `In progress ${done}/${total}`}</span>
              <span className="mono" style={{ fontSize: 11, color: "var(--text-4)" }}>
                started by {s.createdByName} · {formatDateTime(s.createdAt)}
              </span>
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button style={primary} onClick={() => void downloadPdf([s])}>
              Download PDF
            </button>
            <button style={{ ...ghost, height: 38 }} onClick={() => void openPdf([s])}>
              Open / print
            </button>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span className="mono" style={label}>
              {t.serialLabel}
            </span>
            <HeaderField
              value={s.serialNumber}
              mono
              onSave={(serialNumber) => mutate({ kind: "updateHeader", id, patch: { serialNumber } }, () => api.updateSignoffHeader(id, { serialNumber }))}
            />
          </label>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span className="mono" style={label}>
              Type
            </span>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))", gap: 6 }}>
              {types.map((x) => {
                const on = x.id === currentTypeId;
                return (
                  <button
                    key={x.id}
                    onClick={() => void changeType(x.id)}
                    style={{ ...ghost, height: 38, borderColor: on ? "var(--accent)" : "var(--border)", color: on ? "var(--accent)" : "var(--text-3)", background: on ? "var(--accent-wash)" : "transparent" }}
                  >
                    {x.name}
                  </button>
                );
              })}
            </div>
            {!currentTypeId && <span style={{ fontSize: 11.5, color: "var(--text-4)" }}>Recorded as: {typeNameOf(s)}</span>}
          </div>
          <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span className="mono" style={label}>
              Arrived
            </span>
            <ArrivedField value={s.arrivedAt} onSave={(arrivedAt) => mutate({ kind: "updateHeader", id, patch: { arrivedAt } }, () => api.updateSignoffHeader(id, { arrivedAt }))} />
            {!embedded && (
              <Link to={`/signoff/${encodeURIComponent(s.serialNumber)}?id=${s.id}`} style={{ fontSize: 12.5, color: "var(--accent)", fontWeight: 600 }}>
                History of {s.serialNumber} →
              </Link>
            )}
          </label>
        </div>
      </div>

      {error && <div style={errorBox}>{error}</div>}

      {/* Checklist grid */}
      <div style={{ ...card, padding: 0, overflowX: "auto", marginBottom: 12 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13.5, minWidth: 150 + t.checks.length * 80 }}>
          <thead>
            <tr style={{ background: "var(--head-row)" }}>
              <th style={{ ...th, ...stickyCol, background: "var(--head-row)", textAlign: "left" }}>Item</th>
              {t.checks.map((c) => {
                const sig = signedBy(c.id);
                const full = isCheckFullyMarked(s, c.id);
                return (
                  <th key={c.id} style={{ ...th, width: 92 }}>
                    <div>{c.label}</div>
                    {!sig && !full && (
                      <button
                        onClick={() => void mutate({ kind: "fillCheck", id, checkId: c.id, value: "pass" }, () => api.fillCheck(id, c.id, "pass"))}
                        title="Tick every empty item in this check"
                        style={{ ...ghost, height: 32, padding: "0 8px", fontSize: 11.5, marginTop: 4 }}
                      >
                        ✓ all
                      </button>
                    )}
                    {!sig && full && (
                      <button
                        onClick={() => void mutate({ kind: "clearCheck", id, checkId: c.id }, () => api.clearCheck(id, c.id))}
                        title="Untick every item in this check"
                        style={{ ...ghost, height: 32, padding: "0 8px", fontSize: 11.5, marginTop: 4 }}
                      >
                        ✕ all
                      </button>
                    )}
                    {sig && <div style={{ fontSize: 10, color: "var(--text-4)", marginTop: 2 }}>🔒 signed</div>}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {t.rows.map((r) => (
              <tr key={r.id} style={{ borderTop: "1px solid var(--border-soft)" }}>
                <td style={{ ...stickyCol, padding: "8px 10px", paddingLeft: r.indent ? 22 : 10, fontWeight: r.bold ? 700 : 400, color: r.kind === "section" ? "var(--text-2)" : "var(--text)", lineHeight: 1.35 }}>{r.text}</td>
                {t.checks.map((c) =>
                  r.kind === "section" ? (
                    <td key={c.id} style={{ textAlign: "center", color: "var(--text-4)", fontSize: 11 }}>
                      – – –
                    </td>
                  ) : (
                    <td key={c.id} style={{ padding: 3, borderLeft: "1px solid var(--border-soft)" }}>
                      <MarkCell value={markOf(r.id, c.id)} locked={Boolean(signedBy(c.id))} onTap={() => tap(r.id, c.id)} />
                    </td>
                  ),
                )}
              </tr>
            ))}
            {t.signRowEnabled && (
              <tr style={{ borderTop: "2px solid var(--border)" }}>
                <td style={{ ...stickyCol, padding: "10px", fontWeight: 600, color: "var(--text-2)" }}>{t.signRowLabel}</td>
                {t.checks.map((c) => {
                  const sig = signedBy(c.id);
                  const full = isCheckFullyMarked(s, c.id);
                  return (
                    <td key={c.id} style={{ padding: 4, borderLeft: "1px solid var(--border-soft)", verticalAlign: "top", textAlign: "center" }}>
                      {sig ? (
                        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
                          <SignatureImage path={sig.path} height={30} />
                          <div style={{ fontSize: 10.5, lineHeight: 1.2 }}>{sig.name}</div>
                          <div className="mono" style={{ fontSize: 10, color: "var(--text-3)" }}>
                            {sig.date.split("-").reverse().join("/")}
                            {sig.time && <div>{sig.time}</div>}
                          </div>
                          {(sig.userId === me.userId || me.role === "admin") && (
                            <button
                              onClick={async () => {
                                if (await confirmDialog(`Remove ${sig.name}'s signature from ${c.label}? The check's marks become editable again.`, { confirmLabel: "Remove", danger: true })) {
                                  void mutate({ kind: "unsign", id, checkId: c.id }, () => api.unsignCheck(id, c.id));
                                }
                              }}
                              style={{ ...ghost, height: 30, padding: "0 8px", fontSize: 11 }}
                            >
                              remove
                            </button>
                          )}
                        </div>
                      ) : (
                        <button
                          disabled={!full}
                          title={full ? "Sign and date this check" : "Mark every item in this check first"}
                          onClick={() => setSigning(c)}
                          style={{ ...primary, height: 56, width: "100%", padding: 0, fontSize: 13, opacity: full ? 1 : 0.35, cursor: full ? "pointer" : "not-allowed" }}
                        >
                          Sign
                        </button>
                      )}
                    </td>
                  );
                })}
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="mono" style={{ fontSize: 11, color: "var(--text-4)", marginBottom: 16 }}>
        Tap a box: empty → ✓ pass → ✗ fail → N/A → empty. A signed check is locked.
      </div>

      {/* Replaced parts — service mechanisms only */}
      {showParts && (
        <div style={{ ...card, marginBottom: 12 }}>
          <div style={{ fontWeight: 700, marginBottom: 4 }}>Replaced parts</div>
          <div style={{ fontSize: 12.5, color: "var(--text-3)", marginBottom: 10 }}>Tick every part that was replaced on this mechanism. Leave everything unticked if nothing was replaced.</div>
          {allowedParts.length === 0 && s.parts.length === 0 && (
            <div style={{ ...infoBox, marginBottom: 0 }}>
              No parts are defined yet.{" "}
              {me.role === "admin" ? (
                <>
                  Add them in <Link to="/setup/parts" style={{ color: "inherit", fontWeight: 700 }}>Setup → Parts</Link> — they appear here straight away.
                </>
              ) : (
                "Ask an admin to add them in Setup → Parts."
              )}
            </div>
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {allowedParts.map((p) => {
              const line = s.parts.find((l) => l.partId === p.id);
              return (
                <PartRow
                  key={p.id}
                  number={p.partNumber}
                  name={p.name}
                  description={p.description}
                  line={line}
                  onToggle={(on) => {
                    if (on) {
                      const lineId = crypto.randomUUID();
                      void mutate({ kind: "setPart", id, lineId, partId: p.id, qty: 1, note: "" }, () => api.setPartLine(id, lineId, p.id, 1, ""));
                    } else if (line) {
                      void mutate({ kind: "removePart", id, lineId: line.id }, () => api.removePartLine(id, line.id));
                    }
                  }}
                  onChange={(qty, note) => line && void mutate({ kind: "setPart", id, lineId: line.id, partId: p.id, qty, note }, () => api.setPartLine(id, line.id, p.id, qty, note))}
                />
              );
            })}
            {/* Lines whose part has since been removed from the template/catalog stay visible. */}
            {s.parts
              .filter((l) => !allowedParts.some((p) => p.id === l.partId))
              .map((l) => (
                <PartRow key={l.id} number={l.partNumber} name={l.name} description="(no longer in this template's parts list)" line={l} onToggle={(on) => !on && void mutate({ kind: "removePart", id, lineId: l.id }, () => api.removePartLine(id, l.id))} onChange={() => {}} />
              ))}
          </div>
        </div>
      )}

      {/* Notes */}
      <div style={{ ...card, marginBottom: 12 }}>
        <span className="mono" style={label}>
          Notes
        </span>
        <NotesField value={s.notes} onSave={(notes) => mutate({ kind: "updateHeader", id, patch: { notes } }, () => api.updateSignoffHeader(id, { notes }))} />
      </div>

      <button style={danger} onClick={() => void remove()}>
        Delete sign-off
      </button>

      {signing && (
        <SignModal
          checkLabel={signing.label}
          name={me.name}
          onCancel={() => setSigning(null)}
          onSave={(path, date, time) => {
            const checkId = signing.id;
            setSigning(null);
            void mutate({ kind: "sign", id, checkId, path, date, time }, () => api.signCheck(id, checkId, path, date, time));
          }}
        />
      )}
    </div>
  );
}

// With many check columns the grid scrolls sideways on a phone — the item text stays pinned.
const stickyCol = { position: "sticky" as const, left: 0, zIndex: 1, background: "var(--bg-base)" };

const th = { padding: "8px 6px", fontSize: 12, fontWeight: 700, color: "var(--text-2)", textAlign: "center" as const, verticalAlign: "top" as const };

function MarkCell({ value, locked, onTap }: { value: MarkValue | undefined; locked: boolean; onTap: () => void }) {
  const look =
    value === "pass"
      ? { text: "✓", color: "var(--bg-deep)", bg: "var(--accent)", border: "var(--accent)" }
      : value === "fail"
        ? { text: "✗", color: "#fff", bg: "var(--danger)", border: "var(--danger)" }
        : value === "na"
          ? { text: "N/A", color: "var(--text-2)", bg: "var(--surface-alt)", border: "var(--border)" }
          : { text: "", color: "var(--text-3)", bg: "transparent", border: "var(--border)" };
  return (
    <button
      disabled={locked}
      onClick={onTap}
      aria-label={value ?? "not checked"}
      style={{
        width: "100%",
        height: 52,
        borderRadius: "var(--radius-control)",
        border: `1px solid ${look.border}`,
        background: look.bg,
        color: look.color,
        fontWeight: 700,
        fontSize: value === "na" ? 11 : 18,
        cursor: locked ? "default" : "pointer",
        opacity: locked ? 0.75 : 1,
      }}
    >
      {look.text}
    </button>
  );
}

/** ISO <-> the local "YYYY-MM-DDTHH:MM" a datetime-local input wants. */
const toLocalInput = (iso: string) => {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

function ArrivedField({ value, onSave }: { value: string; onSave: (iso: string) => void }) {
  const [v, setV] = useState(toLocalInput(value));
  useEffect(() => setV(toLocalInput(value)), [value]);
  return (
    <input
      type="datetime-local"
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => {
        const t = Date.parse(v);
        if (Number.isNaN(t)) return setV(toLocalInput(value));
        const iso = new Date(t).toISOString();
        if (toLocalInput(iso) !== toLocalInput(value)) onSave(iso);
      }}
      style={input}
    />
  );
}

function HeaderField({ value, onSave, mono }: { value: string; onSave: (v: string) => void; mono?: boolean }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  const commit = () => {
    const next = v.trim();
    if (!next) setV(value);
    else if (next !== value) onSave(next);
  };
  return <input value={v} onChange={(e) => setV(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} className={mono ? "mono" : undefined} style={input} />;
}

function NotesField({ value, onSave }: { value: string; onSave: (v: string) => void }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return (
    <textarea
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => v !== value && onSave(v)}
      rows={3}
      placeholder="Anything worth recording — faults found, repairs done…"
      style={{ ...input, height: "auto", padding: 10, marginTop: 6, resize: "vertical", lineHeight: 1.4 }}
    />
  );
}

const stepButton = {
  width: 48,
  height: 48,
  borderRadius: "var(--radius-control)",
  border: "1px solid var(--border)",
  background: "var(--bg-deep)",
  color: "var(--text)",
  fontSize: 24,
  fontWeight: 700,
  lineHeight: 1,
  cursor: "pointer",
  flex: "none",
} as const;

function PartRow(props: {
  number: string;
  name: string;
  description: string;
  line: { id: string; qty: number; note: string } | undefined;
  onToggle: (on: boolean) => void;
  onChange: (qty: number, note: string) => void;
}) {
  const { line } = props;
  const [qty, setQty] = useState(String(line?.qty ?? 1));
  const [note, setNote] = useState(line?.note ?? "");
  useEffect(() => {
    setQty(String(line?.qty ?? 1));
    setNote(line?.note ?? "");
  }, [line?.qty, line?.note]);
  const clamp = (v: number) => Math.max(1, Math.min(999, Math.round(v) || 1));
  const commit = () => {
    const n = clamp(Number(qty));
    setQty(String(n));
    if (line && (n !== line.qty || note.trim() !== line.note)) props.onChange(n, note.trim());
  };
  /** − / + : saves straight away, no need to leave the field. */
  const step = (by: number) => {
    const n = clamp((Number(qty) || 1) + by);
    setQty(String(n));
    if (line && n !== line.qty) props.onChange(n, note.trim());
  };
  const current = clamp(Number(qty));
  return (
    <div style={{ border: `1px solid ${line ? "var(--accent)" : "var(--border-soft)"}`, background: line ? "var(--accent-wash)" : "transparent", borderRadius: "var(--radius-control)", padding: "8px 10px" }}>
      <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
        <input type="checkbox" checked={Boolean(line)} onChange={(e) => props.onToggle(e.target.checked)} style={{ width: 26, height: 26, accentColor: "var(--accent)", flex: "none" }} />
        <span style={{ minWidth: 0 }}>
          <span className="mono" style={{ fontSize: 12, color: "var(--text-3)", marginRight: 8 }}>
            {props.number}
          </span>
          <span style={{ fontWeight: 600 }}>{props.name}</span>
          {props.description && <div style={{ fontSize: 11.5, color: "var(--text-3)" }}>{props.description}</div>}
        </span>
      </label>
      {line && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10, marginLeft: 36 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, flex: "none" }}>
            <button type="button" onClick={() => step(-1)} disabled={current <= 1} aria-label="Less" style={{ ...stepButton, opacity: current <= 1 ? 0.4 : 1 }}>
              −
            </button>
            <input
              value={qty}
              onChange={(e) => setQty(e.target.value.replace(/\D/g, "").slice(0, 3))}
              onBlur={commit}
              inputMode="numeric"
              aria-label="Quantity"
              className="mono"
              style={{ ...input, width: 64, height: 48, textAlign: "center", fontSize: 18, fontWeight: 700 }}
            />
            <button type="button" onClick={() => step(1)} disabled={current >= 999} aria-label="More" style={stepButton}>
              +
            </button>
          </div>
          <input value={note} onChange={(e) => setNote(e.target.value)} onBlur={commit} placeholder="Note (optional)" style={{ ...input, height: 48, flex: "1 1 180px", width: "auto" }} />
        </div>
      )}
    </div>
  );
}
