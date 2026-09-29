import { toRowData, type SheetRequest, type SheetsApi } from "./SheetsApi.js";

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
 * Writing: plan() turns rows into requests (overwrite in place by id, append the new ones) without
 * calling Google — MirrorService collects the plans of every tab and sends them as ONE batch.
 *
 * Read cache: a tab read twice within `cacheTtlMs` (several devices refreshing after the same
 * change, the mirror upserting two batches back to back, an admin reopening the Backup screen)
 * is answered from memory instead of asking Google again. Concurrent readers share ONE in-flight
 * request. After a successful write the cache holds exactly what was written (no re-read needed);
 * a failed write drops it, so nobody ever sees data older than their own last write.
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

  fresh(): boolean {
    return Boolean(this.cached && Date.now() - this.cached.at < this.cacheTtlMs);
  }

  /** Seeds the cache with a grid read elsewhere (one batchGet covering several tabs). */
  prime(grid: string[][]): void {
    this.invalidate();
    this.cached = { grid, at: Date.now() };
  }

  /** The requests that upsert `rows` by id into this tab (header first if columns are missing —
   * appended on the right, never reordered, a human may have added their own), plus the grid as
   * it will look afterwards. Needs the current grid (readGrid/prime) — calls nothing itself. */
  async plan(sheetId: number, columns: readonly string[], rows: Record<string, string>[]): Promise<{ requests: SheetRequest[]; grid: string[][] }> {
    const grid = (await this.readGrid()).map((r) => [...r]);
    const requests: SheetRequest[] = [];
    const current = grid[0] ?? [];
    const missing = columns.filter((c) => !current.includes(c));
    const header = [...current, ...missing];
    if (missing.length > 0) {
      requests.push({ updateCells: { range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: header.length }, rows: [toRowData(header)], fields: "userEnteredValue" } });
      grid[0] = header;
    }
    const idCol = header.indexOf("id");
    const rowIndexById = new Map<string, number>();
    grid.forEach((r, i) => {
      if (i > 0 && r[idCol]) rowIndexById.set(r[idCol]!, i);
    });
    const toCells = (row: Record<string, string>) => header.map((h, i) => (columns.includes(h) ? (row[h] ?? "") : (grid[rowIndexById.get(row.id!) ?? -1]?.[i] ?? "")));
    const appends: string[][] = [];
    for (const row of rows) {
      const idx = rowIndexById.get(row.id!);
      const cells = toCells(row);
      if (idx === undefined) {
        appends.push(cells);
        rowIndexById.set(row.id!, grid.length);
        grid.push(cells);
      } else {
        requests.push({ updateCells: { range: { sheetId, startRowIndex: idx, endRowIndex: idx + 1, startColumnIndex: 0, endColumnIndex: header.length }, rows: [toRowData(cells)], fields: "userEnteredValue" } });
        grid[idx] = cells;
      }
    }
    if (appends.length > 0) requests.push({ appendCells: { sheetId, rows: appends.map(toRowData), fields: "userEnteredValue" } });
    return { requests, grid };
  }

  /** After the batch carrying this tab's plan succeeded. */
  commit(grid: string[][]): void {
    this.prime(grid);
  }
}
