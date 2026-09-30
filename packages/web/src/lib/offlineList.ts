import { summarize, type SignoffSummary } from "@biosite-signoff/shared";
import { listQueue } from "./offlineQueue.js";
import { cachedSignoff } from "./signoffCache.js";

// Lists keep working without signal: the list data itself comes from the device cache
// (getJsonCached), and sign-offs started here but not yet synced are added on top.

/** Sign-offs started on this device but not synced yet — shown on top of the All list. */
export async function pendingCreates(): Promise<SignoffSummary[]> {
  const out: SignoffSummary[] = [];
  for (const e of await listQueue()) {
    if (e.action.kind !== "createSignoff") continue;
    const s = cachedSignoff(e.action.input.id);
    if (!s) continue;
    out.push(summarize(s));
  }
  return out.reverse();
}
