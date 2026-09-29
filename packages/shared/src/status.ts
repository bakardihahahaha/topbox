import type { Role, Signature, Signoff, SignoffStatus, SignoffSummary, SignoffType, Template } from "./types.js";
import { allowsRefurbishedR, isOncePerTopbox, typeNameOf } from "./types.js";

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

/** The most checks one operator may sign on a single sign-off: the checks are spread as evenly as
 * possible over the operators in the system (2 operators × 2 checks → 1 each; × 3 checks → 2 and
 * 1; × 4 checks → 2 each; a lone operator signs them all). Admins are exempt. */
export function maxChecksPerOperator(checks: number, operators: number): number {
  return Math.ceil(checks / Math.max(1, operators));
}

/** Why this operator may not sign `checkId` under the cross-check rule, or null if they may. */
export function crossCheckBlock(s: Signoff, checkId: string, actor: { userId: string; role: Role }, operators: number): string | null {
  if (actor.role === "admin") return null;
  const max = maxChecksPerOperator(s.template.checks.length, operators);
  const mine = s.signatures.filter((g) => g.checkId !== checkId && g.userId === actor.userId);
  if (mine.length < max) return null;
  const labels = mine.map((g) => s.template.checks.find((c) => c.id === g.checkId)?.label ?? "a check").join(", ");
  return max === 1
    ? `You already signed ${labels} — this check must be signed by a different operator.`
    : `With ${operators} operators, one person may sign at most ${max} of the ${s.template.checks.length} checks — you already signed ${labels}. Another operator must sign this one.`;
}

/** A mechanism's identity across visits: a refurbished unit comes back with an "R" appended to its
 * serial number (667 → 667R) but it's still the same TopBox, so both share one history. */
export function mechanismKey(serial: string): string {
  const s = serial.trim().toUpperCase();
  return /\dR$/.test(s) ? s.slice(0, -1) : s;
}

/** Operators may only add or drop the refurbished "R" on a serial number — nothing else. */
export function isRefurbishToggle(from: string, to: string): boolean {
  const a = from.trim();
  const b = to.trim();
  return a.toUpperCase() !== b.toUpperCase() && mechanismKey(a) === mechanismKey(b) && /^.*\d$/.test(mechanismKey(a));
}

/** Once the first check is signed the sign-off type (New (UK) / Service…) is fixed for operators. */
export function typeLocked(s: Pick<Signoff, "signatures">): boolean {
  return s.signatures.length > 0;
}

/** Why this person may not add a photo to `checkId`, or null if they may. A photo belongs to the
 * check its taker is doing: the one they signed, or — before signing — the next unsigned check,
 * provided the cross-check rule lets them sign it. So if John did check 1 and Mateusz is doing
 * check 2, Mateusz can photograph check 2 only. Admins may add to any check; viewers to none. */
export function photoBlock(s: Signoff, checkId: string, actor: { userId: string; role: Role }, operators: number): string | null {
  if (actor.role === "viewer") return "Viewers can't add photos.";
  if (actor.role === "admin") return null;
  const check = s.template.checks.find((c) => c.id === checkId);
  if (!check) return "Unknown check.";
  const sig = s.signatures.find((g) => g.checkId === checkId);
  if (sig) return sig.userId === actor.userId ? null : `${check.label} was done by ${sig.name} — only they can add its photos.`;
  const next = s.template.checks.find((c) => !s.signatures.some((g) => g.checkId === c.id));
  if (next && next.id !== checkId) return `The check being done now is ${next.label} — photos go to that check.`;
  return crossCheckBlock(s, checkId, actor, operators);
}

/** Why `type` can't be used for a (new or changed) visit of this TopBox, or null if it can.
 * A type marked "only once per TopBox" (like New (UK)) can't be picked again once the TopBox has
 * had a visit of that same type — other types, "only once" ones included, stay available.
 * `visits` are the TopBox's visits (any serial spelling, 667 / 667R). */
export function oncePerTopboxBlock(
  serial: string,
  visits: Pick<Signoff, "id" | "typeId" | "typeName" | "mode">[],
  type: SignoffType,
  selfId?: string,
): string | null {
  if (!isOncePerTopbox(type)) return null;
  // Records from before types had ids are matched by name.
  const sameType = (v: Pick<Signoff, "typeId" | "typeName">) => (v.typeId ? v.typeId === type.id : v.typeName === type.name);
  const prior = visits.find((v) => v.id !== selfId && sameType(v));
  if (!prior) return null;
  return `TopBox ${serial} is already in the database as ${typeNameOf(prior)}. ${type.name} can only be used once per TopBox — choose another type from the list.`;
}

/** The serial carries the refurbished "R" (667R). */
export const hasRefurbishedR = (serial: string) => serial.trim() !== "" && mechanismKey(serial) !== serial.trim().toUpperCase();

/** Why this serial can't be used with this type, or null — the "R" only on types that allow it
 * (Setup → Types). */
export function refurbishedRBlock(serial: string, type: Pick<SignoffType, "name" | "allowsParts" | "refurbishedR">): string | null {
  if (!hasRefurbishedR(serial) || allowsRefurbishedR(type)) return null;
  return `The refurbished "R" can't be used with ${type.name} — only with the types that allow it (Setup → Types). Remove the R or pick another type.`;
}
