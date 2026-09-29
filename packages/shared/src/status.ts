import type { Signoff, SignoffStatus, Template } from "./types.js";

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

export const MARK_LABEL: Record<string, string> = { pass: "✓", fail: "✗", na: "N/A" };

/** Signature capture box — SignaturePad draws in it, the PDF generator scales from it. */
export const SIGNATURE_BOX = { width: 300, height: 100 } as const;
