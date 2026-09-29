import { randomUUID } from "node:crypto";
import type { Store } from "../store/Store.js";

export async function audit(
  store: Store,
  e: { actorId: string | null; action: string; entity: string; entityId?: string | null; detail?: unknown; ip?: string | null },
): Promise<void> {
  await store.audit.write({
    id: randomUUID(),
    actorId: e.actorId,
    action: e.action,
    entity: e.entity,
    entityId: e.entityId ?? null,
    detail: e.detail,
    ip: e.ip ?? null,
    at: new Date().toISOString(),
  });
}

/** Keeps request bodies readable in the audit log without storing whole signature paths. */
export function summarizeForAudit(body: unknown): unknown {
  if (!body || typeof body !== "object") return body;
  return Object.fromEntries(
    Object.entries(body as Record<string, unknown>).map(([k, v]) => [k, typeof v === "string" && v.length > 200 ? `${v.slice(0, 60)}… (${v.length} chars)` : v]),
  );
}
