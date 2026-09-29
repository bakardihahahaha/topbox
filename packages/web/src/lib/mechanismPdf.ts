import { signoffStatus, typeNameOf, type Signoff } from "@biosite-signoff/shared";
import { getVisits } from "./api.js";
import { localStamp } from "./format.js";

/** Which visits of each TopBox go into a batch PDF. */
export type PdfScope = "latest" | "all";

export interface MechanismPdfPlan {
  /** In the order the TopBoxes were picked; each one's visits oldest first. */
  signoffs: Signoff[];
  /** TopBoxes with no finished visit at all — nothing of theirs can be printed. */
  missing: string[];
  /** What was left out, e.g. a visit still in progress. */
  notes: string[];
}

/**
 * A PDF only ever holds finished visits (every check signed) — a half-done checklist is not a
 * record. Per TopBox: "latest" = its most recent finished visit, "all" = every finished visit
 * (its whole history, e.g. 15 services). A visit still in the workshop is left out and named in
 * `notes`, so nobody wonders where it went.
 */
export async function planMechanismPdf(serials: string[], scope: PdfScope): Promise<MechanismPdfPlan> {
  const plan: MechanismPdfPlan = { signoffs: [], missing: [], notes: [] };
  for (const serial of serials) {
    const visits = await getVisits(serial);
    const done = visits.filter((v) => signoffStatus(v) === "complete");
    const current = visits[visits.length - 1];
    if (done.length === 0) {
      plan.missing.push(serial);
      continue;
    }
    plan.signoffs.push(...(scope === "latest" ? [done[done.length - 1]!] : done));
    if (current && signoffStatus(current) !== "complete") {
      plan.notes.push(`${current.serialNumber}: the current visit (${typeNameOf(current)}, arrived ${localStamp(current.arrivedAt)}) isn't finished yet, so it's not in the PDF.`);
    }
  }
  return plan;
}
