import type { Signoff } from "@biosite-signoff/shared";
import { getVisits } from "./api.js";

/** Which visits of each TopBox go into a batch PDF. */
export type PdfScope = "latest" | "all";

/**
 * Per TopBox: "latest" = its most recent visit, "all" = every visit (its whole history, e.g. 15
 * services), oldest first — at whatever stage they are; an unfinished visit prints as it is now.
 * In the order the TopBoxes were picked.
 */
export async function mechanismPdfSignoffs(serials: string[], scope: PdfScope): Promise<Signoff[]> {
  const out: Signoff[] = [];
  for (const serial of serials) {
    const visits = await getVisits(serial);
    out.push(...(scope === "latest" ? visits.slice(-1) : visits));
  }
  return out;
}
