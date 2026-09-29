import { signoffProgress, signoffStatus, typeNameOf, type SignoffSummary } from "@biosite-signoff/shared";
import { listSignoffs, type SignoffFilter } from "./api.js";
import { listQueue } from "./offlineQueue.js";
import { cachedSignoff } from "./signoffCache.js";

// The sign-off list keeps working without signal: the last list fetched on this device is shown,
// with sign-offs started here but not yet synced added on top ("pending" number).
const KEY = "biosite-signoff.list-cache";

type ListResult = { items: SignoffSummary[]; total: number; offline?: boolean };

async function pendingCreates(): Promise<SignoffSummary[]> {
  const out: SignoffSummary[] = [];
  for (const e of await listQueue()) {
    if (e.action.kind !== "createSignoff") continue;
    const s = cachedSignoff(e.action.input.id);
    if (!s) continue;
    const { done, total } = signoffProgress(s);
    out.push({
      id: s.id,
      number: s.number,
      templateId: s.templateId,
      templateName: s.template.name,
      serialNumber: s.serialNumber,
      mode: s.mode,
      typeName: typeNameOf(s),
      status: signoffStatus(s),
      progress: `${done}/${total}`,
      createdByName: s.createdByName,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
    });
  }
  return out.reverse();
}

export async function listSignoffsOfflineAware(f: SignoffFilter): Promise<ListResult> {
  const key = JSON.stringify(f);
  let result: ListResult;
  try {
    result = await listSignoffs(f);
    try {
      localStorage.setItem(KEY, JSON.stringify({ key, result }));
    } catch {
      // best-effort
    }
  } catch (err) {
    let cached: { key: string; result: ListResult } | null = null;
    try {
      cached = JSON.parse(localStorage.getItem(KEY) ?? "null");
    } catch {
      cached = null;
    }
    if (!cached || !(err instanceof TypeError)) throw err; // only a lost connection falls back
    result = { ...cached.result, offline: true };
  }
  const pending = (await pendingCreates()).filter((p) => !result.items.some((i) => i.id === p.id));
  return { ...result, items: [...pending, ...result.items], total: result.total + pending.length };
}
