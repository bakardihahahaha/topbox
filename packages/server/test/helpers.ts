import { SqliteStore } from "../src/store/sqlite/SqliteStore.js";
import { AuthService } from "../src/services/auth.js";
import { CatalogService, mechanismChecklistSeed } from "../src/services/catalog.js";
import { SignoffService } from "../src/services/signoffs.js";
import { MirrorService } from "../src/mirror/MirrorService.js";
import { FakeSheetsApi } from "../src/mirror/SheetsApi.js";
import { buildApp } from "../src/app.js";

export async function setup(opts: { withSheets?: boolean } = {}) {
  const store = new SqliteStore(":memory:");
  const auth = new AuthService(store);
  const catalog = new CatalogService(store);
  const signoffs = new SignoffService(store);
  const sheets = new FakeSheetsApi();
  const mirror = new MirrorService(store, opts.withSheets === false ? null : sheets, "sheet-1", { cacheTtlMs: 60_000 });
  const app = await buildApp({ store, auth, catalog, signoffs, mirror });
  await auth.createUser({ username: "admin", name: "Admin", role: "admin" }, null, "admin-pass");
  await auth.createUser({ username: "op", name: "Olga Operator", role: "operator" }, null, "op-pass");
  await auth.createUser({ username: "op2", name: "Otto", role: "operator" }, null, "op2-pass");
  const template = await catalog.createTemplate(mechanismChecklistSeed());

  async function login(username: string, password: string, ip = "10.0.0.1") {
    const res = await app.inject({ method: "POST", url: "/api/auth/login", payload: { username, password }, remoteAddress: ip });
    return { res, token: res.statusCode === 200 ? (res.json() as { token: string }).token : "" };
  }

  function as(token: string, ip = "10.0.0.1") {
    const call = (method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", url: string, payload?: unknown) =>
      app.inject({ method, url, payload: payload as never, remoteAddress: ip, headers: { authorization: `Bearer ${token}` } });
    return call;
  }

  return { store, auth, catalog, signoffs, sheets, mirror, app, template, login, as };
}
