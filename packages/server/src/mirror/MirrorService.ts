import type { Store } from "../store/Store.js";
import { TABLES, tableSpec, type MirroredTable, type Row } from "../store/schema.js";
import { SheetTable } from "./SheetTable.js";
import { statusOf, type SheetRequest, type SheetsApi } from "./SheetsApi.js";

export const SPREADSHEET_SETTING = "backup.spreadsheet_id";
const LAST_SUCCESS_SETTING = "backup.last_success_at";
export const SEED_TEMPLATE_SETTING = "seed.template_id";

export interface MirrorStatus {
  configured: boolean;
  spreadsheetId: string | null;
  credentials: boolean;
  pending: number;
  lastSuccessAt: string | null;
  lastError: string | null;
  lastErrorAt: string | null;
  backoffUntil: string | null;
}

/**
 * One-way backup: NAS (source of truth) -> Google Sheet. Every write already committed to the NAS
 * put its (table, row id) into the Store's outbox in the same transaction; this pushes the current
 * version of those rows to the sheet in the background and only then clears them from the outbox.
 * Users never wait on Google — a save is done the moment it hits the NAS — and a Google outage or
 * quota burst just means the outbox waits and drains later. Nothing is lost if the process dies.
 *
 * The sheet is never read back as a source of truth, except by an explicit admin restore.
 */
export class MirrorService {
  private tables = new Map<string, SheetTable>();
  private tablesFor: string | null = null;
  /** Tab title -> numeric sheet id, read once and kept (tabs are only ever added by us). */
  private sheetIds: Map<string, number> | null = null;
  private running = false;
  private again = false;
  private kickTimer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private backoffUntil = 0;
  private failures = 0;
  private lastError: { message: string; at: string } | null = null;

  constructor(
    private readonly store: Store,
    private readonly api: SheetsApi | null,
    private readonly defaultSpreadsheetId: string | null,
    private readonly opts: { batchSize?: number; cacheTtlMs?: number } = {},
  ) {}

  async spreadsheetId(): Promise<string | null> {
    return (await this.store.settings.get(SPREADSHEET_SETTING)) || this.defaultSpreadsheetId || null;
  }

  /** Returns true when this replaced a different, previously used sheet — the caller then queues
   * a full re-copy. Pointing at a sheet for the first time needs no re-copy: every row written
   * so far has been waiting in the outbox all along. */
  async setSpreadsheetId(id: string): Promise<boolean> {
    const previous = await this.spreadsheetId();
    await this.store.settings.set(SPREADSHEET_SETTING, id);
    this.tables.clear();
    this.tablesFor = null;
    this.sheetIds = null;
    this.backoffUntil = 0;
    this.failures = 0;
    this.lastError = null;
    return Boolean(previous && previous !== id && (await this.store.settings.get(LAST_SUCCESS_SETTING)));
  }

  private table(spreadsheetId: string, name: string): SheetTable {
    if (this.tablesFor !== spreadsheetId) {
      this.tables.clear();
      this.tablesFor = spreadsheetId;
    }
    let t = this.tables.get(name);
    if (!t) {
      t = new SheetTable(this.api!, spreadsheetId, name, this.opts.cacheTtlMs);
      this.tables.set(name, t);
    }
    return t;
  }

  private async sheetIdsFor(spreadsheetId: string): Promise<Map<string, number>> {
    if (this.tablesFor !== spreadsheetId) this.sheetIds = null;
    if (!this.sheetIds) this.sheetIds = new Map((await this.api!.listSheets(spreadsheetId)).map((s) => [s.title, s.sheetId]));
    return this.sheetIds;
  }

  /** Forget everything cached about the sheet — after a failed write nothing is assumed. */
  private forgetSheet(): void {
    this.sheetIds = null;
    for (const t of this.tables.values()) t.invalidate();
  }

  /** Pushes everything currently pending. Returns how many rows were mirrored. Throws on a Google
   * error (after recording it) — callers that run in the background swallow it, an admin's
   * "Sync now" lets it reach the global error translator in main.ts. */
  async flush(): Promise<number> {
    const spreadsheetId = await this.spreadsheetId();
    if (!this.api || !spreadsheetId) return 0;
    if (this.running) {
      // A write landed while a push is in progress — push again right after it.
      this.again = true;
      return 0;
    }
    this.running = true;
    let total = 0;
    try {
      for (;;) {
        const pending = await this.store.outbox.pending(this.opts.batchSize ?? 500);
        if (pending.length === 0) break;
        const byTable = new Map<MirroredTable, string[]>();
        for (const p of pending) byTable.set(p.table, [...(byTable.get(p.table) ?? []), p.rowId]);
        total += await this.pushBatch(spreadsheetId, byTable);
        await this.store.outbox.ack(pending);
      }
      this.failures = 0;
      this.backoffUntil = 0;
      this.lastError = null;
      await this.store.settings.set(LAST_SUCCESS_SETTING, new Date().toISOString());
      return total;
    } catch (err) {
      this.failures++;
      // Google's quota is per minute — after a 429 wait a full window; anything else backs off
      // exponentially up to 10 minutes so a misconfigured sheet doesn't hammer the API.
      const delayMs = statusOf(err) === 429 ? 60_000 : Math.min(10 * 60_000, 15_000 * 2 ** (this.failures - 1));
      this.backoffUntil = Date.now() + delayMs;
      this.lastError = { message: describeError(err), at: new Date().toISOString() };
      throw err;
    } finally {
      this.running = false;
      if (this.again) {
        this.again = false;
        this.kick();
      }
    }
  }

  /** Everything pending — any number of rows over any number of tabs — goes to Google as ONE
   * write call (spreadsheets:batchUpdate: new tabs, rows overwritten in place, new rows appended).
   * Knowing which row holds which id takes at most one read call for all tabs together, skipped
   * while the tabs' read cache is fresh. */
  private async pushBatch(spreadsheetId: string, byTable: Map<MirroredTable, string[]>): Promise<number> {
    try {
      const ids = await this.sheetIdsFor(spreadsheetId);
      const requests: SheetRequest[] = [];
      const newTabs = new Set<string>();
      for (const name of byTable.keys()) {
        if (ids.has(name)) continue;
        let sheetId = 0;
        const used = new Set(ids.values());
        while (sheetId === 0 || used.has(sheetId)) sheetId = 1 + Math.floor(Math.random() * 2_000_000_000);
        requests.push({ addSheet: { properties: { title: name, sheetId } } });
        ids.set(name, sheetId);
        newTabs.add(name);
        this.table(spreadsheetId, name).prime([]);
      }
      const toRead = [...byTable.keys()].filter((n) => !newTabs.has(n) && !this.table(spreadsheetId, n).fresh());
      const grids = toRead.length > 0 ? await this.api!.batchGet(spreadsheetId, toRead.map((n) => `${n}!A1:ZZ`)) : [];
      toRead.forEach((n, i) => this.table(spreadsheetId, n).prime(grids[i] ?? []));

      const commits: (() => void)[] = [];
      let rowsPushed = 0;
      for (const [name, rowIds] of byTable) {
        const rows = await this.store.tables.readRows(name, rowIds);
        const table = this.table(spreadsheetId, name);
        const plan = await table.plan(ids.get(name)!, tableSpec(name).columns, rows);
        requests.push(...plan.requests);
        commits.push(() => table.commit(plan.grid));
        rowsPushed += rows.length;
      }
      await this.api!.batch(spreadsheetId, requests);
      commits.forEach((c) => c());
      return rowsPushed;
    } catch (err) {
      this.forgetSheet();
      throw err;
    }
  }

  /** Push to Google right after a write — debounced by a second so a burst of taps (a whole
   * column ticked, a signature plus its marks) goes out as one batch. The interval in start() is
   * only a safety net for anything this misses. Respects the quota backoff. */
  kick(delayMs = 1000): void {
    if (!this.api || this.kickTimer || this.stopped) return;
    this.kickTimer = setTimeout(() => {
      this.kickTimer = null;
      if (Date.now() < this.backoffUntil) return;
      this.flush().catch(() => {
        /* recorded in lastError; retried after backoff */
      });
    }, delayMs);
    this.kickTimer.unref?.();
  }

  /** Background loop — checks the outbox every `intervalMs`, respecting any backoff. */
  start(intervalMs = 15_000): void {
    this.stopped = false;
    if (this.timer) return;
    this.timer = setInterval(() => {
      if (Date.now() < this.backoffUntil) return;
      this.flush().catch(() => {
        /* recorded in lastError; retried after backoff */
      });
    }, intervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    this.stopped = true;
    if (this.kickTimer) clearTimeout(this.kickTimer);
    this.kickTimer = null;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async resyncAll(): Promise<number> {
    return this.store.outbox.enqueueAll();
  }

  async status(): Promise<MirrorStatus> {
    const spreadsheetId = await this.spreadsheetId();
    return {
      configured: Boolean(this.api && spreadsheetId),
      spreadsheetId,
      credentials: Boolean(this.api),
      pending: await this.store.outbox.count(),
      lastSuccessAt: await this.store.settings.get(LAST_SUCCESS_SETTING),
      lastError: this.lastError?.message ?? null,
      lastErrorAt: this.lastError?.at ?? null,
      backoffUntil: this.backoffUntil > Date.now() ? new Date(this.backoffUntil).toISOString() : null,
    };
  }

  /** Row counts per tab on the sheet — reads go through each tab's read cache. */
  async inspect(): Promise<{ table: string; sheetRows: number; localRows: number }[]> {
    const spreadsheetId = await this.spreadsheetId();
    if (!this.api || !spreadsheetId) throw new Error("Backup spreadsheet is not configured.");
    const tabs = new Set((await this.api.listSheets(spreadsheetId)).map((s) => s.title));
    const out = [];
    for (const t of TABLES) {
      const sheetRows = tabs.has(t.name) ? (await this.table(spreadsheetId, t.name).readAll()).filter((r) => !r.deleted_at).length : 0;
      out.push({ table: t.name, sheetRows, localRows: await this.store.tables.countRows(t.name) });
    }
    return out;
  }

  /** Disaster recovery: pulls every tab from the backup sheet into the (fresh) local database. */
  async restore(): Promise<Record<string, number>> {
    const spreadsheetId = await this.spreadsheetId();
    if (!this.api || !spreadsheetId) throw new Error("Backup spreadsheet is not configured.");
    const tabs = new Set((await this.api.listSheets(spreadsheetId)).map((s) => s.title));
    const result: Record<string, number> = {};
    for (const t of TABLES) {
      if (!tabs.has(t.name)) {
        result[t.name] = 0;
        continue;
      }
      const rows = (await this.table(spreadsheetId, t.name).readAll()) as Row[];
      result[t.name] = await this.store.tables.importRows(t.name, rows);
    }
    // A fresh install seeds an example template; if nobody used it, it must not end up next to the
    // restored real one (it may even have been mirrored to the sheet before the restore ran).
    const seedId = await this.store.settings.get(SEED_TEMPLATE_SETTING);
    if (seedId && (await this.store.templates.get(seedId))) {
      const used = (await this.store.signoffs.list({ templateId: seedId, limit: 1, offset: 0 })).total > 0;
      if (!used) await this.store.templates.softDelete(seedId, new Date().toISOString());
    }
    return result;
  }
}

function describeError(err: unknown): string {
  const s = statusOf(err);
  if (s === 429) return "Google Sheets quota exceeded — waiting a minute before retrying.";
  if (s === 403) return "The service account has no access to this spreadsheet — share it with the service account's email (Editor).";
  if (s === 404) return "Spreadsheet not found — check the spreadsheet ID.";
  return err instanceof Error ? err.message : String(err);
}
