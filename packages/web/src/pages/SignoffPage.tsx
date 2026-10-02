import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { allowedPartIds, allowsRefurbishedR, checkOrderBlock, crossCheckBlock, firstCheckBlock, isCheckFullyMarked, mechanismKey, photoBlock, signoffProgress, signoffStatus, summarize, typeNameOf, type MarkValue, type Part, type Signoff, type Template, type TemplateCheck } from "@biosite-signoff/shared";
import * as api from "../lib/api.js";
import { ApiError } from "../lib/client.js";
import { useMe } from "../lib/meContext.js";
import { applyLocal } from "../lib/localSignoff.js";
import { mutateOrQueue, onQueueSynced, pendingFor, type QueuedAction } from "../lib/offlineQueue.js";
import { onDataChange } from "../lib/liveEvents.js";
import { withSaving } from "../lib/savingStatus.js";
import { cacheSignoff, cachedSignoff, forgetSignoff } from "../lib/signoffCache.js";
import { downloadPdf, viewPdf } from "../lib/pdfLazy.js";
import { confirmDialog } from "../lib/confirmDialog.js";
import { SignatureImage } from "../components/SignaturePad.js";
import { SignModal } from "../components/SignModal.js";
import { useSignoffTypes } from "../lib/signoffTypes.js";
import { useOperatorCount } from "../lib/permissions.js";
import { topboxUrl } from "../lib/format.js";
import { signStamp, useShowSignTime } from "../lib/documentSettings.js";
import { CameraButton, PhotoStrip, PhotosCard } from "../components/PhotosCard.js";
import { SerialInput } from "../components/SerialInput.js";
import { rememberPhoto, toJpegDataUrl } from "../lib/photos.js";
import { card, chip, danger, errorBox, errorMessage, ghost, infoBox, input, label, page, primary } from "../lib/ui.js";

const NEXT: Record<string, MarkValue | null> = { none: "pass", pass: "fail", fail: "na", na: null };

/** One sign-off (one visit of a TopBox). Used on its own (/signoffs/:id, older links) and embedded
 * in the TopBox page (/signoff/:serial) above that serial's history. */
export function SignoffPage({ signoffId, embedded, earlierVisit }: { signoffId?: string; embedded?: boolean; earlierVisit?: boolean } = {}) {
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
  const [photoBusy, setPhotoBusy] = useState<string | null>(null);
  // Opened on its own (/signoffs/:id) nobody tells us whether a later visit exists — look it up.
  const [laterVisitExists, setLaterVisitExists] = useState(false);
  // Admin correcting a signed check: asked once per sign-off; the operator's signature stays.
  const [adminEditOk, setAdminEditOk] = useState(false);
  const serialForVisits = embedded ? "" : (signoff?.serialNumber ?? "");
  useEffect(() => {
    if (!serialForVisits) return;
    const check = () =>
      void api.getVisits(serialForVisits).then((v) => {
        const i = v.findIndex((x) => x.id === id);
        setLaterVisitExists(i >= 0 && i < v.length - 1);
      }, () => {});
    check();
    return onDataChange(check);
  }, [serialForVisits, id]);
  const types = useSignoffTypes();
  const operators = useOperatorCount();
  const showTime = useShowSignTime();
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
      // Deleted (by anyone, on any device) — never show a stale copy of it from this device.
      if (err instanceof ApiError && err.status === 404) {
        forgetSignoff(id);
        setSignoff(null);
        setLoadError("This sign-off was deleted (or doesn't exist). If it was a mistake, an admin can restore it from the Deleted tab.");
        return;
      }
      base = cachedSignoff(id);
      if (!base) {
        setLoadError(errorMessage(err));
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
  const isAdmin = me.role === "admin";
  const viewer = me.role === "viewer";
  // An earlier visit of this TopBox is history — look and print only (admins may still correct).
  const oldVisit = Boolean(earlierVisit) || laterVisitExists;
  // A completed sign-off is a closed record for operators, and so is any earlier visit; a viewer
  // only ever looks (the server enforces all three).
  const closed = (status === "complete" && !isAdmin) || (oldVisit && !isAdmin) || viewer;
  // Replaced parts: only people allowed to start sign-offs (Setup → Users) record them.
  const partsLocked = closed || (!isAdmin && me.canStart === false);
  // Operators and admins can delete (soft — it goes to the admin's Deleted tab and can be restored);
  // operators only the TopBox's current visit, older visits are history.
  const canDelete = !viewer && (isAdmin || !oldVisit);
  const { done, total } = signoffProgress(s);
  const signedBy = (checkId: string) => s.signatures.find((g) => g.checkId === checkId);
  const markOf = (rowId: string, checkId: string) => s.marks.find((m) => m.rowId === rowId && m.checkId === checkId)?.value;
  const allowed = allowedPartIds(t, liveTemplate);
  const allowedParts = allowed === "all" ? parts : parts.filter((p) => allowed.has(p.id));
  const showParts = s.mode === "service";
  const firstCheckAt = summarize(s).firstCheckAt;
  // The type is what the mechanism was checked as — fixed for operators after the first check.
  // Refurbished units get an "R" after the serial number (667 → 667R) — the one serial change an
  // operator may make.
  const serialKey = mechanismKey(s.serialNumber);
  const hasR = serialKey !== s.serialNumber.trim().toUpperCase();
  // Adding the R only on types that allow it (Setup → Types); taking it off always.
  const currentType = types.find((x) => x.id === s.typeId);
  const canToggleR = !isAdmin && !closed && /\d$/.test(serialKey) && (hasR || Boolean(currentType && allowsRefurbishedR(currentType)));
  function toggleR() {
    const next = hasR ? s.serialNumber.trim().slice(0, -1) : `${s.serialNumber.trim()}R`;
    void mutate({ kind: "updateHeader", id, patch: { serialNumber: next } }, () => api.updateSignoffHeader(id, { serialNumber: next }));
  }

  /** Why this column is locked for me: the 1st check is only for people allowed to start
   * sign-offs (Setup → Users); later checks open one at a time, once the one before is signed. */
  // Also locked: a check this person may not sign under the cross-check rule (they already did
  // their share) — another operator does that whole check, ticks included.
  const lockReason = (checkId: string) => crossCheckBlock(s, checkId, me, operators);
  const notMine = (checkId: string) => lockReason(checkId) !== null;

  async function tap(rowId: string, checkId: string) {
    if (notMine(checkId)) return setError(lockReason(checkId));
    const sig = signedBy(checkId);
    if (sig && isAdmin && !adminEditOk) {
      const ok = await confirmDialog(
        `${t.checks.find((c) => c.id === checkId)?.label ?? "This check"} is signed by ${sig.name}. Change marks in it anyway? Their signature stays as it is; the change is recorded in the audit log under your name.`,
        { confirmLabel: "Edit as admin" },
      );
      if (!ok) return;
      setAdminEditOk(true);
    }
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

  /** Camera → shrunk JPEG → shown at once, uploaded with the queue. */
  // Operators take back only their own photos (until the sign-off is complete); admins any.
  const canRemovePhoto = (p: { takenBy: string }) => isAdmin || (!closed && p.takenBy === me.userId);
  const removePhotoNow = (photoId: string) => mutate({ kind: "removePhoto", id, photoId }, () => api.removePhoto(id, photoId));

  async function takePhotos(checkId: string, files: File[], as?: { userId: string; name: string }) {
    setPhotoBusy(checkId);
    try {
      // One after another — each is shrunk, shown and queued before the next is read.
      for (const file of files) {
        const dataUrl = await toJpegDataUrl(file);
        const photoId = crypto.randomUUID();
        const takenAt = new Date().toISOString();
        await rememberPhoto(photoId, dataUrl);
        await mutate({ kind: "addPhoto", id, photoId, checkId, dataUrl, takenAt, asUserId: as?.userId, asName: as?.name }, () => api.addPhoto(id, photoId, checkId, dataUrl, takenAt, as?.userId));
      }
    } catch (err) {
      setError(`Couldn't use that photo: ${errorMessage(err)}`);
    } finally {
      setPhotoBusy(null);
    }
  }

  async function remove() {
    const message = `Delete this ${typeNameOf(s)} sign-off of ${s.serialNumber}?\n\nIt disappears from the lists and the TopBox's history (its other visits stay as they are). ${isAdmin ? "You can restore it from the Deleted tab." : "An admin can restore it if it was a mistake."}`;
    if (!(await confirmDialog(message, { confirmLabel: "Delete", danger: true }))) return;
    try {
      await withSaving(() => mutateOrQueue({ kind: "deleteSignoff", id }, () => api.deleteSignoff(id)));
      forgetSignoff(id);
      // Back to the TopBox page — its remaining visits (or "Start first sign-off" if none left).
      navigate(topboxUrl(s.serialNumber), { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <div style={{ ...(embedded ? {} : page), ...(oldVisit ? HISTORY_GREY : {}) }}>
      {/* Header */}
      <div style={{ ...card, marginBottom: 12, display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "flex-start" }}>
          <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              <span style={chip(status === "complete" ? "accent" : "warn")}>{status === "complete" ? "Complete" : `In progress ${done}/${total}`}</span>
              <span style={chip("muted")}>{typeNameOf(s)}</span>
            </div>
            <span className="mono" style={{ fontSize: 11.5, color: "var(--text-3)" }}>
              started by {s.createdByName} · 1st check {firstCheckAt ? signStamp(firstCheckAt, showTime) : "not done yet"}
            </span>
          </div>
          {/* The PDF can be made at any stage — it shows the checklist as it is right now. */}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button style={primary} onClick={() => void downloadPdf([s])}>
              Download PDF
            </button>
            <button style={{ ...ghost, height: 38 }} onClick={() => viewPdf([s])}>
              View PDF
            </button>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span className="mono" style={label}>
              {t.serialLabel}
            </span>
            <LockedField
              display={s.serialNumber}
              initial={s.serialNumber}
              canEdit={isAdmin}
              mono
              serial
              onSave={(serialNumber) => {
                const next = serialNumber.trim();
                if (next && next !== s.serialNumber) void mutate({ kind: "updateHeader", id, patch: { serialNumber: next } }, () => api.updateSignoffHeader(id, { serialNumber: next }));
              }}
            />
            {canToggleR && (
              <button type="button" onClick={toggleR} style={{ ...ghost, height: 44 }} title="R = refurbished">
                {hasR ? `Remove R → ${s.serialNumber.trim().slice(0, -1)}` : `+R refurbished → ${s.serialNumber.trim()}R`}
              </button>
            )}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span className="mono" style={label}>
              Type
            </span>
            {isAdmin ? (
              // Admin only: change the type — all the buttons on one line.
              <div style={{ display: "grid", gridTemplateColumns: `repeat(${Math.max(types.length, 1)}, minmax(0, 1fr))`, gap: 6 }}>
                {types.map((x) => {
                  const on = x.id === currentTypeId;
                  return (
                    <button
                      key={x.id}
                      onClick={() => void changeType(x.id)}
                      style={{ ...ghost, height: 44, padding: "0 6px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", borderColor: on ? "var(--accent)" : "var(--border)", color: on ? "var(--accent)" : "var(--text-3)", background: on ? "var(--accent-wash)" : "transparent" }}
                    >
                      {x.name}
                    </button>
                  );
                })}
              </div>
            ) : (
              // Everyone else: the type chosen at the start, fixed. A wrong one = delete and start again.
              <div style={{ ...input, display: "flex", alignItems: "center", background: "transparent", borderStyle: "dashed", fontWeight: 700, fontSize: 16 }}>{typeNameOf(s)}</div>
            )}
            {isAdmin && !currentTypeId && <span style={{ fontSize: 11.5, color: "var(--text-4)" }}>Recorded as: {typeNameOf(s)}</span>}
          </div>
          <div style={{ display: "flex", alignItems: "flex-end" }}>
            {!embedded && (
              <Link to={`/signoff/${encodeURIComponent(s.serialNumber)}?id=${s.id}`} style={{ fontSize: 12.5, color: "var(--accent)", fontWeight: 600 }}>
                History of {s.serialNumber} →
              </Link>
            )}
          </div>
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
                    {!sig && !full && !closed && !notMine(c.id) && (
                      <button
                        onClick={() => void mutate({ kind: "fillCheck", id, checkId: c.id, value: "pass" }, () => api.fillCheck(id, c.id, "pass"))}
                        title="Tick every empty item in this check"
                        style={{ ...ghost, height: 32, padding: "0 8px", fontSize: 11.5, marginTop: 4 }}
                      >
                        ✓ all
                      </button>
                    )}
                    {!sig && full && !closed && !notMine(c.id) && (
                      <button
                        onClick={() => void mutate({ kind: "clearCheck", id, checkId: c.id }, () => api.clearCheck(id, c.id))}
                        title="Untick every item in this check"
                        style={{ ...ghost, height: 32, padding: "0 8px", fontSize: 11.5, marginTop: 4 }}
                      >
                        ✕ all
                      </button>
                    )}
                    {sig && <div style={{ fontSize: 10, color: "var(--text-4)", marginTop: 2 }}>{isAdmin ? "✎ signed — admin can edit" : "🔒 signed"}</div>}
                    {!sig && !closed && notMine(c.id) && (
                      <div style={{ fontSize: 10, color: "var(--text-4)", marginTop: 2 }} title={lockReason(c.id) ?? ""}>
                        {firstCheckBlock(s, c.id, me) ? "🔒 starters only" : checkOrderBlock(s, c.id, me) ? "🔒 not yet" : "🔒 other operator"}
                      </div>
                    )}
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
                    <td key={c.id} style={{ padding: 3, borderLeft: "1px solid var(--border-soft)", opacity: !closed && !signedBy(c.id) && notMine(c.id) ? 0.35 : 1 }}>
                      <MarkCell value={markOf(r.id, c.id)} locked={(Boolean(signedBy(c.id)) && !isAdmin) || closed || notMine(c.id)} onTap={() => tap(r.id, c.id)} />
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
                  const block = sig ? null : crossCheckBlock(s, c.id, me, operators);
                  return (
                    <td key={c.id} style={{ padding: 4, borderLeft: "1px solid var(--border-soft)", verticalAlign: "top", textAlign: "center" }}>
                      {sig ? (
                        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
                          <SignatureImage path={sig.path} height={30} />
                          <div style={{ fontSize: 10.5, lineHeight: 1.2 }}>{sig.name}</div>
                          <div className="mono" style={{ fontSize: 10, color: "var(--text-3)" }}>
                            {sig.date.split("-").reverse().join("/")}
                            {sig.time && showTime && <div>{sig.time}</div>}
                          </div>
                          {isAdmin && (
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
                      ) : closed ? (
                        <div style={{ color: "var(--text-4)", fontSize: 12, padding: "18px 0" }}>not signed</div>
                      ) : (
                        <button
                          disabled={!full}
                          title={block ?? (full ? "Sign and date this check" : "Mark every item in this check first")}
                          onClick={() => (block ? setError(block) : setSigning(c))}
                          style={{ ...primary, height: 56, width: "100%", padding: 0, fontSize: 13, opacity: full && !block ? 1 : 0.35, cursor: full ? "pointer" : "not-allowed" }}
                        >
                          {firstCheckBlock(s, c.id, me) ? "Starters only" : checkOrderBlock(s, c.id, me) ? "Not yet" : block ? "Other operator" : "Sign"}
                        </button>
                      )}
                      {!closed && (
                        <div style={{ marginTop: 6 }}>
                          <CameraButton
                            signoff={s}
                            checkId={c.id}
                            checkLabel={c.label}
                            busy={photoBusy === c.id}
                            blocked={photoBlock(s, c.id, me, operators)}
                            onBlocked={setError}
                            onFiles={(files, as) => takePhotos(c.id, files, as)}
                            canRemove={canRemovePhoto}
                            onRemove={removePhotoNow}
                            isAdmin={isAdmin}
                            me={me}
                          />
                        </div>
                      )}
                      <PhotoStrip signoff={s} checkId={c.id} canRemove={canRemovePhoto} onRemove={removePhotoNow} />
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
          <div style={{ fontSize: 12.5, color: "var(--text-3)", marginBottom: 10 }}>
            {partsLocked && !closed ? "🔒 Only people allowed to start sign-offs record replaced parts." : "Tick every part that was replaced on this mechanism. Leave everything unticked if nothing was replaced."}
          </div>
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
                  disabled={partsLocked}
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
                <PartRow key={l.id} number={l.partNumber} name={l.name} description="(no longer in this template's parts list)" line={l} disabled={partsLocked} onToggle={(on) => !on && void mutate({ kind: "removePart", id, lineId: l.id }, () => api.removePartLine(id, l.id))} onChange={() => {}} />
              ))}
          </div>
        </div>
      )}

      <PhotosCard
        signoff={s}
        canRemove={canRemovePhoto}
        onRemove={removePhotoNow}
      />

      {/* Notes */}
      <div style={{ ...card, marginBottom: 12 }}>
        <span className="mono" style={label}>
          Notes
        </span>
        <NotesField value={s.notes} readOnly={closed} onSave={(notes) => mutate({ kind: "updateHeader", id, patch: { notes } }, () => api.updateSignoffHeader(id, { notes }))} />
      </div>

      {closed && (
        <div className="mono" style={{ fontSize: 12, color: "var(--text-3)", marginBottom: 12 }}>
          {viewer
            ? "👁 View only — you can look and download the PDF."
            : oldVisit
              ? "🔒 Earlier visit — history, view only. Only an admin can change it."
              : "🔒 Complete — this record is closed. Only an admin can change it."}
        </div>
      )}
      {canDelete && (
        <button style={danger} onClick={() => void remove()}>
          Delete sign-off
        </button>
      )}

      {signing && (
        <SignModal
          checkLabel={signing.label}
          showTime={showTime}
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

/** An earlier visit is drawn in greys: the theme's green (ticks, buttons, chips) is swapped for
 * neutral tones on this subtree only — plain CSS variables, so pop-ups (photos, PDF) still work. */
const HISTORY_GREY = {
  "--accent": "var(--text-3)",
  "--accent-wash": "var(--surface-alt)",
  "--accent-wash-text": "var(--text-2)",
  "--warn": "var(--text-3)",
} as React.CSSProperties;

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

/** A value that's fixed once the sign-off is started. Operators only see it; an admin taps the
 * pencil first, then edits and saves (or cancels) — never an accidental edit. */
function LockedField(props: { display: string; initial: string; canEdit: boolean; onSave: (v: string) => void; mono?: boolean; inputType?: string; serial?: boolean }) {
  const [editing, setEditing] = useState(false);
  const [v, setV] = useState(props.initial);
  useEffect(() => {
    if (!editing) setV(props.initial);
  }, [props.initial, editing]);
  if (!editing) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div className={props.mono ? "mono" : undefined} style={{ ...input, display: "flex", alignItems: "center", background: "transparent", borderStyle: "dashed", fontWeight: 700, fontSize: 16 }}>
          {props.display}
        </div>
        {props.canEdit && (
          <button type="button" onClick={() => setEditing(true)} aria-label="Edit" title="Edit (admin)" style={{ ...ghost, width: 44, height: 44, padding: 0, fontSize: 18, flex: "none" }}>
            ✎
          </button>
        )}
      </div>
    );
  }
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
      {props.serial ? (
        <div style={{ flex: "1 1 160px" }}>
          <SerialInput value={v} onChange={setV} />
        </div>
      ) : (
        <input autoFocus type={props.inputType ?? "text"} value={v} onChange={(e) => setV(e.target.value)} className={props.mono ? "mono" : undefined} style={{ ...input, flex: "1 1 160px", width: "auto" }} />
      )}
      <button
        type="button"
        style={{ ...primary, height: 44 }}
        onClick={() => {
          props.onSave(v);
          setEditing(false);
        }}
      >
        Save
      </button>
      <button type="button" style={{ ...ghost, height: 44 }} onClick={() => setEditing(false)}>
        Cancel
      </button>
    </div>
  );
}

function NotesField({ value, onSave, readOnly }: { value: string; onSave: (v: string) => void; readOnly?: boolean }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return (
    <textarea
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => !readOnly && v !== value && onSave(v)}
      readOnly={readOnly}
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
  disabled?: boolean;
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
        <input type="checkbox" checked={Boolean(line)} disabled={props.disabled} onChange={(e) => props.onToggle(e.target.checked)} style={{ width: 26, height: 26, accentColor: "var(--accent)", flex: "none" }} />
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
            <button type="button" onClick={() => step(-1)} disabled={props.disabled || current <= 1} aria-label="Less" style={{ ...stepButton, opacity: current <= 1 ? 0.4 : 1 }}>
              −
            </button>
            <input
              value={qty}
              onChange={(e) => setQty(e.target.value.replace(/\D/g, "").slice(0, 3))}
              readOnly={props.disabled}
              onBlur={commit}
              inputMode="numeric"
              aria-label="Quantity"
              className="mono"
              style={{ ...input, width: 64, height: 48, textAlign: "center", fontSize: 18, fontWeight: 700 }}
            />
            <button type="button" onClick={() => step(1)} disabled={props.disabled || current >= 999} aria-label="More" style={stepButton}>
              +
            </button>
          </div>
          <input value={note} readOnly={props.disabled} onChange={(e) => setNote(e.target.value)} onBlur={commit} placeholder="Note (optional)" style={{ ...input, height: 48, flex: "1 1 180px", width: "auto" }} />
        </div>
      )}
    </div>
  );
}
