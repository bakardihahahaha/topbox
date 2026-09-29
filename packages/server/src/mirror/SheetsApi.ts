import { GoogleAuth } from "google-auth-library";

// The handful of Sheets REST calls the backup mirror needs — called directly through
// google-auth-library's authorized client instead of pulling in the whole `googleapis` package.
// FakeSheetsApi (below) implements the same interface in memory for local dev and tests, and can
// be told to answer 429 to exercise the rate-limit path.

export interface SheetsApi {
  listTabs(spreadsheetId: string): Promise<string[]>;
  addTab(spreadsheetId: string, title: string): Promise<void>;
  /** Whole-tab read, e.g. "parts!A1:ZZ". */
  getValues(spreadsheetId: string, range: string): Promise<string[][]>;
  batchUpdate(spreadsheetId: string, data: { range: string; values: string[][] }[]): Promise<void>;
  append(spreadsheetId: string, range: string, values: string[][]): Promise<void>;
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

  async listTabs(spreadsheetId: string) {
    const data = await this.request<{ sheets?: { properties?: { title?: string } }[] }>({
      url: `${BASE}/${encodeURIComponent(spreadsheetId)}`,
      params: { fields: "sheets.properties.title" },
    });
    return (data.sheets ?? []).map((s) => s.properties?.title ?? "");
  }

  async addTab(spreadsheetId: string, title: string) {
    await this.request({ url: `${BASE}/${encodeURIComponent(spreadsheetId)}:batchUpdate`, method: "POST", data: { requests: [{ addSheet: { properties: { title } } }] } });
  }

  async getValues(spreadsheetId: string, range: string) {
    const data = await this.request<{ values?: string[][] }>({ url: `${BASE}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}` });
    return data.values ?? [];
  }

  // valueInputOption RAW: stored exactly as sent — a "2026-09-29" or "0012" never gets turned into
  // a date/number cell by Sheets' own type detection, so restore reads back the identical string.
  async batchUpdate(spreadsheetId: string, data: { range: string; values: string[][] }[]) {
    if (data.length === 0) return;
    await this.request({ url: `${BASE}/${encodeURIComponent(spreadsheetId)}/values:batchUpdate`, method: "POST", data: { valueInputOption: "RAW", data } });
  }

  async append(spreadsheetId: string, range: string, values: string[][]) {
    if (values.length === 0) return;
    await this.request({
      url: `${BASE}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}:append`,
      method: "POST",
      params: { valueInputOption: "RAW", insertDataOption: "INSERT_ROWS" },
      data: { values },
    });
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

  async listTabs(spreadsheetId: string) {
    this.maybeFail();
    this.calls.read++;
    return [...this.tabs.keys()].filter((k) => k.startsWith(`${spreadsheetId}/`)).map((k) => k.slice(spreadsheetId.length + 1));
  }
  async addTab(spreadsheetId: string, title: string) {
    this.maybeFail();
    this.calls.write++;
    if (!this.tabs.has(this.key(spreadsheetId, title))) this.tabs.set(this.key(spreadsheetId, title), []);
  }
  async getValues(spreadsheetId: string, range: string) {
    this.maybeFail();
    this.calls.read++;
    const tab = range.split("!")[0]!;
    return (this.tabs.get(this.key(spreadsheetId, tab)) ?? []).map((r) => [...r]);
  }
  async batchUpdate(spreadsheetId: string, data: { range: string; values: string[][] }[]) {
    this.maybeFail();
    this.calls.write++;
    for (const d of data) {
      const [tab, cell] = d.range.split("!") as [string, string];
      const rowIndex = Number(/\d+/.exec(cell)![0]) - 1;
      const grid = this.tabs.get(this.key(spreadsheetId, tab)) ?? [];
      d.values.forEach((row, i) => (grid[rowIndex + i] = [...row]));
      this.tabs.set(this.key(spreadsheetId, tab), grid);
    }
  }
  async append(spreadsheetId: string, range: string, values: string[][]) {
    this.maybeFail();
    this.calls.write++;
    const tab = range.split("!")[0]!;
    const grid = this.tabs.get(this.key(spreadsheetId, tab)) ?? [];
    grid.push(...values.map((r) => [...r]));
    this.tabs.set(this.key(spreadsheetId, tab), grid);
  }
}
