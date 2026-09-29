import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PhotoFiles } from "../src/services/photoFiles.js";
import { SignoffTypesService } from "../src/services/signoffTypes.js";
import { SqliteStore } from "../src/store/sqlite/SqliteStore.js";
import { AuthService } from "../src/services/auth.js";
import { CatalogService, mechanismChecklistSeed } from "../src/services/catalog.js";
import { SignoffService } from "../src/services/signoffs.js";
import { MirrorService } from "../src/mirror/MirrorService.js";
import { FakeSheetsApi } from "../src/mirror/SheetsApi.js";
import { buildApp } from "../src/app.js";

/** Smallest thing the server accepts as a JPEG (SOI marker + padding) — as an upload data URL. */
export const FAKE_JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 7)]);
export const FAKE_JPEG_URL = `data:image/jpeg;base64,${FAKE_JPEG.toString("base64")}`;

export async function setup(opts: { withSheets?: boolean; now?: () => number } = {}) {
  const store = new SqliteStore(":memory:");
  const auth = new AuthService(store, { now: opts.now });
  const catalog = new CatalogService(store);
  const signoffTypes = new SignoffTypesService(store);
  const photosDir = mkdtempSync(join(tmpdir(), "topbox-photos-"));
  const signoffs = new SignoffService(store, signoffTypes, new PhotoFiles(photosDir));
  const sheets = new FakeSheetsApi();
  const mirror = new MirrorService(store, opts.withSheets === false ? null : sheets, "sheet-1", { cacheTtlMs: 60_000 });
  const app = await buildApp({ store, auth, catalog, signoffs, signoffTypes, mirror });
  // Tests refer to users by alias; PINs below.
  const ids: Record<string, string> = {
    admin: (await auth.createUser({ name: "Admin", role: "admin", pin: "1111" }, null)).id,
    op: (await auth.createUser({ name: "Olga Operator", role: "operator", pin: "2222" }, null)).id,
    op2: (await auth.createUser({ name: "Otto", role: "operator", pin: "3333" }, null)).id,
  };
  const template = await catalog.createTemplate(mechanismChecklistSeed());

  async function login(alias: string, pin: string, ip = "10.0.0.1") {
    const res = await app.inject({ method: "POST", url: "/api/auth/login", payload: { userId: ids[alias] ?? alias, pin }, remoteAddress: ip });
    return { res, token: res.statusCode === 200 ? (res.json() as { token: string }).token : "" };
  }

  function as(token: string, ip = "10.0.0.1") {
    const call = (method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", url: string, payload?: unknown) =>
      app.inject({ method, url, payload: payload as never, remoteAddress: ip, headers: { authorization: `Bearer ${token}` } });
    return call;
  }

  return { photosDir, ids, store, auth, catalog, signoffs, signoffTypes, sheets, mirror, app, template, login, as };
}
