// Durable write queue (IndexedDB) — same design as decom's offlineQueue.ts, trimmed to this app.
//
// The rule that matters, kept deliberately narrow:
//   - no connectivity (fetch threw a TypeError)             -> keep queued, retry when back online
//   - 503 + error "RATE_LIMITED" (server's one "busy" code) -> keep queued, retry after retry-after
//   - ANY other failure (400/403/404/409/500…)              -> a real rejection: shown at once,
//                                                             never retried
// That split is what stops a genuine bug from hiding inside an endless retry loop while still
// making quota blips invisible — the user just sees the "syncing" dot, never an error.
//
// Every id (sign-off, part line, part, template) is generated on the client, so replaying any
// queued write is idempotent on the server and nothing needs re-mapping after it syncs.
import type { DocumentSettings, MarkValue, PartInput, SignoffMode, SignoffType, TemplateInput } from "@biosite-signoff/shared";
import { saveSignoffTypes } from "./signoffTypes.js";
import { ApiError } from "./client.js";
import * as api from "./api.js";

export type QueuedAction =
  // `mode` only on entries queued before sign-off types existed — the server still accepts it.
  | { kind: "createSignoff"; input: { id: string; templateId: string; serialNumber: string; typeId?: string; mode?: SignoffMode; arrivedAt?: string } }
  | { kind: "updateHeader"; id: string; patch: { serialNumber?: string; notes?: string; typeId?: string; mode?: SignoffMode; arrivedAt?: string } }
  | { kind: "setMark"; id: string; rowId: string; checkId: string; value: MarkValue | null }
  | { kind: "fillCheck"; id: string; checkId: string; value: MarkValue }
  | { kind: "clearCheck"; id: string; checkId: string }
  | { kind: "sign"; id: string; checkId: string; path: string; date: string; time?: string }
  | { kind: "unsign"; id: string; checkId: string }
  | { kind: "setPart"; id: string; lineId: string; partId: string; qty: number; note: string }
  | { kind: "removePart"; id: string; lineId: string }
  | { kind: "deleteSignoff"; id: string }
  | { kind: "createPart"; partId: string; input: PartInput }
  | { kind: "updatePart"; partId: string; patch: Partial<PartInput> }
  | { kind: "deletePart"; partId: string }
  | { kind: "createTemplate"; templateId: string; input: TemplateInput }
  | { kind: "updateTemplate"; templateId: string; input: TemplateInput }
  | { kind: "deleteTemplate"; templateId: string }
  | { kind: "saveDocumentSettings"; settings: DocumentSettings }
  | { kind: "saveSignoffTypes"; types: SignoffType[] };

function describe(a: QueuedAction): string {
  switch (a.kind) {
    case "createSignoff":
      return `Create sign-off for ${a.input.serialNumber}`;
    case "updateHeader":
      return "Update sign-off details";
    case "setMark":
      return "Change a check mark";
    case "fillCheck":
      return "Tick a whole check column";
    case "clearCheck":
      return "Untick a whole check column";
    case "sign":
      return "Sign a check";
    case "unsign":
      return "Remove a signature";
    case "setPart":
      return "Record a replaced part";
    case "removePart":
      return "Remove a replaced part";
    case "deleteSignoff":
      return "Delete a sign-off";
    case "createPart":
      return `Add part ${a.input.partNumber}`;
    case "updatePart":
      return "Update a part";
    case "deletePart":
      return "Delete a part";
    case "createTemplate":
      return `Create template "${a.input.name}"`;
    case "updateTemplate":
      return `Save template "${a.input.name}"`;
    case "deleteTemplate":
      return "Delete a template";
    case "saveDocumentSettings":
      return "Save document settings";
    case "saveSignoffTypes":
      return "Save sign-off types";
  }
}

async function apply(a: QueuedAction): Promise<unknown> {
  switch (a.kind) {
    case "createSignoff":
      return api.createSignoff(a.input);
    case "updateHeader":
      return api.updateSignoffHeader(a.id, a.patch);
    case "setMark":
      return api.setMark(a.id, a.rowId, a.checkId, a.value);
    case "fillCheck":
      return api.fillCheck(a.id, a.checkId, a.value);
    case "clearCheck":
      return api.clearCheck(a.id, a.checkId);
    case "sign":
      return api.signCheck(a.id, a.checkId, a.path, a.date, a.time);
    case "unsign":
      return api.unsignCheck(a.id, a.checkId);
    case "setPart":
      return api.setPartLine(a.id, a.lineId, a.partId, a.qty, a.note);
    case "removePart":
      return api.removePartLine(a.id, a.lineId);
    case "deleteSignoff":
      return api.deleteSignoff(a.id);
    case "createPart":
      return api.createPart(a.partId, a.input);
    case "updatePart":
      return api.updatePart(a.partId, a.patch);
    case "deletePart":
      return api.deletePart(a.partId);
    case "createTemplate":
      return api.createTemplate(a.templateId, a.input);
    case "updateTemplate":
      return api.updateTemplate(a.templateId, a.input);
    case "deleteTemplate":
      return api.deleteTemplate(a.templateId);
    case "saveDocumentSettings":
      return api.saveDocumentSettings(a.settings);
    case "saveSignoffTypes":
      return saveSignoffTypes(a.types);
  }
}

export interface QueueEntry {
  id: string;
  action: QueuedAction;
  createdAt: string;
}

const DB_NAME = "biosite-signoff-offline-queue";
const STORE = "queue";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "id" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(req ? req.result : undefined);
    tx.onerror = () => reject(tx.error);
  });
}

export async function listQueue(): Promise<QueueEntry[]> {
  const all = ((await withStore("readonly", (s) => s.getAll())) ?? []) as QueueEntry[];
  return all.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/** Still-unsynced actions touching one sign-off — the sign-off screen replays them on top of the
 * server copy so a reload while offline still shows everything the user did. */
export async function pendingFor(signoffId: string): Promise<QueuedAction[]> {
  return (await listQueue()).map((e) => e.action).filter((a) => ("id" in a && a.id === signoffId) || (a.kind === "createSignoff" && a.input.id === signoffId));
}

let seq = 0;
async function enqueue(action: QueuedAction): Promise<void> {
  // createdAt + a per-session counter keeps order stable for writes made in the same millisecond.
  const entry: QueueEntry = { id: crypto.randomUUID(), action, createdAt: `${new Date().toISOString()}#${String(seq++).padStart(6, "0")}` };
  await withStore("readwrite", (s) => void s.add(entry));
  await refreshCount();
}

async function removeEntry(id: string): Promise<void> {
  await withStore("readwrite", (s) => void s.delete(id));
}

export function isRetryable(err: unknown): boolean {
  if (err instanceof TypeError) return true; // fetch never reached the server
  return err instanceof ApiError && err.status === 503 && err.code === "RATE_LIMITED";
}

let retryTimer: ReturnType<typeof setTimeout> | null = null;

/** One pending timer at a time. Waits the server's retry-after (+1.5s so several devices don't
 * all retry on the exact same instant), or 15s when there's no header (a network error — the
 * "online" listener below usually beats it anyway). */
function scheduleRetry(err: unknown): void {
  if (retryTimer) return;
  const seconds = err instanceof ApiError && err.retryAfterSeconds ? err.retryAfterSeconds : 15;
  retryTimer = setTimeout(
    () => {
      retryTimer = null;
      void flushQueue();
    },
    seconds * 1000 + 1500,
  );
}

let flushing = false;
const syncedListeners = new Set<() => void>();

/** Replays queued writes in order. A retryable failure stops the flush where it is (order
 * matters: a mark must not overtake the create of its sign-off) and schedules another attempt; a
 * real rejection drops that one entry and reports it. */
export async function flushQueue(): Promise<void> {
  if (flushing) return;
  flushing = true;
  let appliedAny = false;
  try {
    for (const entry of await listQueue()) {
      try {
        await apply(entry.action);
        await removeEntry(entry.id);
        appliedAny = true;
      } catch (err) {
        if (isRetryable(err)) {
          scheduleRetry(err);
          return;
        }
        await removeEntry(entry.id);
        recordFailure(entry.action, err);
      } finally {
        await refreshCount();
      }
    }
  } finally {
    flushing = false;
    if (appliedAny) syncedListeners.forEach((l) => l());
  }
}

/** Fired after queued writes reached the server — screens refetch. */
export function onQueueSynced(listener: () => void): () => void {
  syncedListeners.add(listener);
  return () => syncedListeners.delete(listener);
}

/** Try now; if offline or the server says "busy", queue it and report `synced: false` — the
 * caller keeps its optimistic local state. Any other error is thrown for the caller to show. */
export async function mutateOrQueue<T>(action: QueuedAction, run: () => Promise<T>): Promise<{ synced: true; result: T } | { synced: false }> {
  // Anything already queued must go first, or this write would overtake it.
  if (!navigator.onLine || cachedCount > 0) {
    await enqueue(action);
    if (navigator.onLine) void flushQueue();
    return { synced: false };
  }
  try {
    return { synced: true, result: await run() };
  } catch (err) {
    if (isRetryable(err)) {
      await enqueue(action);
      scheduleRetry(err);
      return { synced: false };
    }
    throw err;
  }
}

let cachedCount = 0;
const countListeners = new Set<(n: number) => void>();

async function refreshCount(): Promise<void> {
  cachedCount = (await listQueue()).length;
  countListeners.forEach((l) => l(cachedCount));
}

export const getCachedQueueCount = () => cachedCount;
export function subscribeQueueCount(listener: (n: number) => void): () => void {
  countListeners.add(listener);
  return () => countListeners.delete(listener);
}

let failures: string[] = [];
const failureListeners = new Set<(f: string[]) => void>();

function recordFailure(action: QueuedAction, err: unknown): void {
  failures = [...failures, `${describe(action)}: ${err instanceof Error ? err.message : String(err)}`].slice(-5);
  failureListeners.forEach((l) => l(failures));
}

export const getRecentQueueFailures = () => failures;
export function subscribeQueueFailures(listener: (f: string[]) => void): () => void {
  failureListeners.add(listener);
  return () => failureListeners.delete(listener);
}
export function dismissQueueFailures(): void {
  failures = [];
  failureListeners.forEach((l) => l(failures));
}

if (typeof window !== "undefined") {
  window.addEventListener("online", () => void flushQueue());
  // iPad/iOS Safari doesn't reliably fire "online" when signal comes back (and navigator.onLine
  // can be wrong either way), so also try whenever the app comes back to the foreground, and
  // every 10s while anything is still waiting. An attempt with no signal just fails quietly and
  // the writes stay queued.
  const tryNow = () => {
    if (cachedCount > 0) void flushQueue();
  };
  document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && tryNow());
  window.addEventListener("focus", tryNow);
  window.addEventListener("pageshow", tryNow);
  setInterval(tryNow, 10_000);
  void refreshCount().then(() => {
    if (navigator.onLine) void flushQueue();
  });
}
