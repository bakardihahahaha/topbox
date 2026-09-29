import type { Signature, Signoff, SignoffStatus, SignoffSummary, Template } from "./types.js";
import { typeNameOf } from "./types.js";

export function itemRows(template: Template) {
  return template.rows.filter((r) => r.kind === "item");
}

/** A check column is "done" once every item row in it has a mark. */
export function isCheckFullyMarked(signoff: Pick<Signoff, "template" | "marks">, checkId: string): boolean {
  const marked = new Set(signoff.marks.filter((m) => m.checkId === checkId).map((m) => m.rowId));
  return itemRows(signoff.template).every((r) => marked.has(r.id));
}

export function isCheckComplete(signoff: Pick<Signoff, "template" | "marks" | "signatures">, checkId: string): boolean {
  if (!isCheckFullyMarked(signoff, checkId)) return false;
  return !signoff.template.signRowEnabled || signoff.signatures.some((s) => s.checkId === checkId);
}

export function signoffProgress(signoff: Pick<Signoff, "template" | "marks" | "signatures">): { done: number; total: number } {
  const total = signoff.template.checks.length;
  const done = signoff.template.checks.filter((c) => isCheckComplete(signoff, c.id)).length;
  return { done, total };
}

export function signoffStatus(signoff: Pick<Signoff, "template" | "marks" | "signatures">): SignoffStatus {
  const { done, total } = signoffProgress(signoff);
  return total > 0 && done === total ? "complete" : "draft";
}

/** Which parts can be recorded as replaced on a sign-off. `frozen` = the checklist copy on the
 * sign-off, `live` = its current version (so parts enabled later count too). A checklist with no
 * parts ticked offers every defined part — ticking some narrows the list for that checklist. */
export function allowedPartIds(frozen: Template, live?: Template | null): "all" | Set<string> {
  const current = live ?? frozen;
  if (current.partIds.length === 0) return "all";
  return new Set([...frozen.partIds, ...current.partIds]);
}

/** "YYYY-MM-DD HH:MM" (or just the date on old records) of a signature. */
export function signatureStamp(sig: Pick<Signature, "date" | "time">): string {
  return sig.time ? `${sig.date} ${sig.time}` : sig.date;
}

/** When the mechanism left after this visit: the last check column's signature (or, for a
 * checklist without a sign row, when it was completed). null while still in the workshop. */
export function departedAt(s: Pick<Signoff, "template" | "marks" | "signatures" | "updatedAt">): string | null {
  if (signoffStatus(s) !== "complete") return null;
  if (!s.template.signRowEnabled) return s.updatedAt.slice(0, 16).replace("T", " ");
  const last = s.template.checks[s.template.checks.length - 1];
  const sig = last && s.signatures.find((g) => g.checkId === last.id);
  return sig ? signatureStamp(sig) : null;
}

export const MARK_LABEL: Record<string, string> = { pass: "✓", fail: "✗", na: "N/A" };

/** Signature capture box — SignaturePad draws in it, the PDF generator scales from it. */
export const SIGNATURE_BOX = { width: 300, height: 100 } as const;

/** When a check column was completed: its signature's date + time, or (checklists without a
 * sign row) the latest mark in it. null while incomplete. */
export function checkDoneAt(s: Pick<Signoff, "template" | "marks" | "signatures">, checkId: string): { at: string; by: string } | null {
  if (!isCheckComplete(s, checkId)) return null;
  if (s.template.signRowEnabled) {
    const sig = s.signatures.find((g) => g.checkId === checkId)!;
    return { at: signatureStamp(sig), by: sig.name };
  }
  const last = s.marks.filter((m) => m.checkId === checkId).sort((a, b) => b.at.localeCompare(a.at))[0];
  return last ? { at: last.at.slice(0, 16).replace("T", " "), by: last.byName } : null;
}

/** The list-row view of a sign-off — one definition for the server and the offline list. */
export function summarize(s: Signoff): SignoffSummary {
  const { done, total } = signoffProgress(s);
  const first = s.template.checks[0] ? checkDoneAt(s, s.template.checks[0].id) : null;
  return {
    id: s.id,
    number: s.number,
    templateId: s.templateId,
    templateName: s.template.name,
    serialNumber: s.serialNumber,
    mode: s.mode,
    typeName: typeNameOf(s),
    arrivedAt: s.arrivedAt,
    departedAt: departedAt(s),
    firstCheckAt: first?.at ?? null,
    firstCheckBy: first?.by ?? null,
    status: signoffStatus(s),
    progress: `${done}/${total}`,
    createdByName: s.createdByName,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
  };
}

/** Total drawn length of a signature path in its 300x100 box. A dot or a tiny flick is not a
 * signature — both the Sign dialog and the server require at least MIN_SIGNATURE_LENGTH. */
export const MIN_SIGNATURE_LENGTH = 60;
export function signatureLength(path: string): number {
  let total = 0;
  let prev: { x: number; y: number } | null = null;
  const re = /([ML])\s*(-?\d+(?:\.\d+)?)[\s,]+(-?\d+(?:\.\d+)?)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(path))) {
    const pt = { x: Number(m[2]), y: Number(m[3]) };
    if (m[1] === "L" && prev) total += Math.hypot(pt.x - prev.x, pt.y - prev.y);
    prev = pt;
  }
  return total;
}
