import { GoogleAuth } from "google-auth-library";

// The handful of Sheets REST calls the backup mirror needs — called directly through
// google-auth-library's authorized client instead of pulling in the whole `googleapis` package.
// FakeSheetsApi (below) implements the same interface in memory for local dev and tests, and can
// be told to answer 429 to exercise the rate-limit path.

/** One request inside a single spreadsheets:batchUpdate call — the mirror sends every change of a
 * sync (new tabs, overwritten rows, appended rows, across all tabs) as ONE such call. */
export type SheetRequest =
  | { addSheet: { properties: { title: string; sheetId: number } } }
  | { updateCells: { range: { sheetId: number; startRowIndex: number; endRowIndex: number; startColumnIndex: number; endColumnIndex: number }; rows: SheetRowData[]; fields: "userEnteredValue" } }
  | { appendCells: { sheetId: number; rows: SheetRowData[]; fields: "userEnteredValue" } };

export interface SheetRowData {
  values: { userEnteredValue?: { stringValue: string } }[];
}

/** Values stored as plain strings — a "2026-09-29" or "0012" never becomes a date/number cell, so
 * a restore reads back exactly what was written. */
export const toRowData = (cells: string[]): SheetRowData => ({ values: cells.map((v) => (v === "" ? {} : { userEnteredValue: { stringValue: v } })) });

export interface SheetsApi {
  /** Every tab with its numeric id (1 read). */
  listSheets(spreadsheetId: string): Promise<{ title: string; sheetId: number }[]>;
  /** Whole-tab read, e.g. "parts!A1:ZZ". */
  getValues(spreadsheetId: string, range: string): Promise<string[][]>;
  /** Several ranges in one read call — result in the same order as `ranges`. */
  batchGet(spreadsheetId: string, ranges: string[]): Promise<string[][][]>;
  /** Everything in one write call, applied by Google in order, all or nothing. */
  batch(spreadsheetId: string, requests: SheetRequest[]): Promise<void>;
}

export function statusOf(err: unknown): number | undefined {
  const e = err as { code?: number | string; status?: number; response?: { status?: number } };
  const s = e?.response?.status ?? e?.status ?? e?.code;
  return typeof s === "number" ? s : undefined;
}

/** Short in-process retry for a momentary blip (a single 429/5xx) — a sustained quota burst still
 * surfaces as a 429 after this, which the mirror worker backs off from and main.ts's global error
 * handler turns into 503 RATE_LIMITED for anything a user triggered directly. */
const RETRYABLE = new Set([429, 500, 502, 503, 504]);
export async function withRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (err) {
      const s = statusOf(err);
      if (!s || !RETRYABLE.has(s) || i >= attempts - 1) throw err;
      await new Promise((r) => setTimeout(r, 300 * 2 ** i + Math.random() * 200));
    }
  }
}

const BASE = "https://sheets.googleapis.com/v4/spreadsheets";

export class GoogleSheetsApi implements SheetsApi {
  private readonly auth: GoogleAuth;

  constructor(serviceAccountJsonPath: string) {
    this.auth = new GoogleAuth({ keyFile: serviceAccountJsonPath, scopes: ["https://www.googleapis.com/auth/spreadsheets"] });
  }

  private async request<T>(opts: { url: string; method?: "GET" | "POST" | "PUT"; data?: unknown; params?: Record<string, string> }): Promise<T> {
    return withRetry(async () => {
      const client = await this.auth.getClient();
      const res = await client.request<T>({ ...opts, timeout: 20_000 });
      return res.data;
    });
  }

  async listSheets(spreadsheetId: string) {
    const data = await this.request<{ sheets?: { properties?: { title?: string; sheetId?: number } }[] }>({
      url: `${BASE}/${encodeURIComponent(spreadsheetId)}`,
      params: { fields: "sheets.properties(title,sheetId)" },
    });
    return (data.sheets ?? []).map((s) => ({ title: s.properties?.title ?? "", sheetId: s.properties?.sheetId ?? 0 }));
  }

  async getValues(spreadsheetId: string, range: string) {
    const data = await this.request<{ values?: string[][] }>({ url: `${BASE}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}` });
    return data.values ?? [];
  }

  async batchGet(spreadsheetId: string, ranges: string[]) {
    if (ranges.length === 0) return [];
    const query = ranges.map((r) => `ranges=${encodeURIComponent(r)}`).join("&");
    const data = await this.request<{ valueRanges?: { values?: string[][] }[] }>({ url: `${BASE}/${encodeURIComponent(spreadsheetId)}/values:batchGet?${query}` });
    return ranges.map((_, i) => data.valueRanges?.[i]?.values ?? []);
  }

  async batch(spreadsheetId: string, requests: SheetRequest[]) {
    if (requests.length === 0) return;
    await this.request({ url: `${BASE}/${encodeURIComponent(spreadsheetId)}:batchUpdate`, method: "POST", data: { requests } });
  }
}

/** In-memory stand-in. `failNext(n)` makes the next n calls throw a Google-shaped 429. */
export class FakeSheetsApi implements SheetsApi {
  readonly tabs = new Map<string, string[][]>();
  calls = { read: 0, write: 0 };
  private failures = 0;

  failNext(n: number) {
    this.failures = n;
  }

  private maybeFail() {
    if (this.failures > 0) {
      this.failures--;
      throw Object.assign(new Error("Quota exceeded for quota metric 'Read requests'"), { response: { status: 429 } });
    }
  }

  private key(spreadsheetId: string, tab: string) {
    return `${spreadsheetId}/${tab}`;
  }

  private sheetIds = new Map<string, number>(); // "<spreadsheet>/<tab>" -> sheetId

  async listSheets(spreadsheetId: string) {
    this.maybeFail();
    this.calls.read++;
    return [...this.tabs.keys()]
      .filter((k) => k.startsWith(`${spreadsheetId}/`))
      .map((k) => ({ title: k.slice(spreadsheetId.length + 1), sheetId: this.sheetIds.get(k) ?? 0 }));
  }
  async getValues(spreadsheetId: string, range: string) {
    this.maybeFail();
    this.calls.read++;
    return this.grid(spreadsheetId, range.split("!")[0]!);
  }
  async batchGet(spreadsheetId: string, ranges: string[]) {
    this.maybeFail();
    this.calls.read++;
    return ranges.map((r) => this.grid(spreadsheetId, r.split("!")[0]!));
  }
  async batch(spreadsheetId: string, requests: SheetRequest[]) {
    this.maybeFail();
    this.calls.write++;
    // All or nothing, like Google: work on copies, swap in at the end.
    const next = new Map([...this.tabs].map(([k, g]) => [k, g.map((r) => [...r])]));
    const ids = new Map(this.sheetIds);
    const titleOf = (sheetId: number) => {
      const key = [...ids.entries()].find(([k, v]) => v === sheetId && k.startsWith(`${spreadsheetId}/`))?.[0];
      if (!key) throw Object.assign(new Error(`No sheet with id ${sheetId}`), { response: { status: 400 } });
      return key;
    };
    const cells = (r: SheetRowData) => r.values.map((v) => v.userEnteredValue?.stringValue ?? "");
    for (const req of requests) {
      if ("addSheet" in req) {
        const key = this.key(spreadsheetId, req.addSheet.properties.title);
        next.set(key, []);
        ids.set(key, req.addSheet.properties.sheetId);
      } else if ("updateCells" in req) {
        const key = titleOf(req.updateCells.range.sheetId);
        const grid = next.get(key)!;
        req.updateCells.rows.forEach((r, i) => (grid[req.updateCells.range.startRowIndex + i] = cells(r)));
      } else {
        const grid = next.get(titleOf(req.appendCells.sheetId))!;
        grid.push(...req.appendCells.rows.map(cells));
      }
    }
    this.tabs.clear();
    for (const [k, g] of next) this.tabs.set(k, g);
    this.sheetIds = ids;
  }
  private grid(spreadsheetId: string, tab: string) {
    return (this.tabs.get(this.key(spreadsheetId, tab)) ?? []).map((r) => [...r]);
  }
}
