import type { SheetsApi } from "./SheetsApi.js";

export function columnLetter(index: number): string {
  let n = index + 1;
  let s = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/**
 * One Google Sheets tab, addressed by header name, with a short server-side read cache.
 *
 * Read cache: a tab read twice within `cacheTtlMs` (several devices refreshing after the same
 * change, the mirror upserting two batches back to back, an admin reopening the Backup screen)
 * is answered from memory instead of asking Google again. Concurrent readers share ONE in-flight
 * request. The cache is dropped the moment anything is written to this tab — success or failure,
 * since a failed write may still have partially landed — so nobody ever sees data older than
 * their own last write, while the number of calls against Google's per-minute quota falls.
 */
export class SheetTable {
  private cached: { grid: string[][]; at: number } | null = null;
  private inflight: Promise<string[][]> | null = null;
  /** Bumped on every invalidate — a read that started before a write must not repopulate the
   * cache with the pre-write grid once it resolves. */
  private generation = 0;

  constructor(
    private readonly api: SheetsApi,
    private readonly spreadsheetId: string,
    readonly tab: string,
    private readonly cacheTtlMs = 10_000,
  ) {}

  invalidate(): void {
    this.cached = null;
    this.inflight = null;
    this.generation++;
  }

  async readGrid(): Promise<string[][]> {
    if (this.cached && Date.now() - this.cached.at < this.cacheTtlMs) return this.cached.grid;
    if (this.inflight) return this.inflight;
    const gen = this.generation;
    const p = this.api
      .getValues(this.spreadsheetId, `${this.tab}!A1:ZZ`)
      .then((grid) => {
        if (gen === this.generation) this.cached = { grid, at: Date.now() };
        return grid;
      })
      .finally(() => {
        if (this.inflight === p) this.inflight = null;
      });
    this.inflight = p;
    return p;
  }

  /** Every data row as a column-name keyed object. */
  async readAll(): Promise<Record<string, string>[]> {
    const [header, ...rows] = await this.readGrid();
    if (!header) return [];
    return rows.filter((r) => r.some((v) => v !== "")).map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ""])));
  }

  private async write<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } finally {
      this.invalidate();
    }
  }

  /** Makes sure the header row holds every column in `columns` (appending any missing ones on
   * the right, never reordering what's there — a human may have added their own columns). */
  async ensureHeader(columns: readonly string[]): Promise<string[]> {
    const grid = await this.readGrid();
    const header = grid[0] ?? [];
    const missing = columns.filter((c) => !header.includes(c));
    if (missing.length === 0) return header;
    const next = [...header, ...missing];
    await this.write(() => this.api.batchUpdate(this.spreadsheetId, [{ range: `${this.tab}!A1`, values: [next] }]));
    return next;
  }

  /** Upsert by `id`: existing rows are overwritten in place (one batched call), new ones appended
   * (one call). Rows are never deleted from the sheet — the app soft-deletes via deleted_at. */
  async upsert(columns: readonly string[], rows: Record<string, string>[]): Promise<void> {
    if (rows.length === 0) return;
    const header = await this.ensureHeader(columns);
    const grid = await this.readGrid();
    const idCol = header.indexOf("id");
    const rowIndexById = new Map<string, number>();
    grid.forEach((r, i) => {
      if (i > 0 && r[idCol]) rowIndexById.set(r[idCol]!, i);
    });

    const toCells = (row: Record<string, string>) => header.map((h, i) => (columns.includes(h) ? (row[h] ?? "") : (grid[rowIndexById.get(row.id!) ?? -1]?.[i] ?? "")));
    const updates: { range: string; values: string[][] }[] = [];
    const appends: string[][] = [];
    const lastCol = columnLetter(header.length - 1);
    for (const row of rows) {
      const idx = rowIndexById.get(row.id!);
      if (idx === undefined) appends.push(toCells(row));
      else updates.push({ range: `${this.tab}!A${idx + 1}:${lastCol}${idx + 1}`, values: [toCells(row)] });
    }
    await this.write(async () => {
      await this.api.batchUpdate(this.spreadsheetId, updates);
      await this.api.append(this.spreadsheetId, `${this.tab}!A1`, appends);
    });
  }
}
