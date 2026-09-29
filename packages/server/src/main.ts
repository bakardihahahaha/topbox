import { mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { SqliteStore } from "./store/sqlite/SqliteStore.js";
import { AuthService } from "./services/auth.js";
import { CatalogService, mechanismChecklistSeed } from "./services/catalog.js";
import { SignoffService } from "./services/signoffs.js";
import { MirrorService, SEED_TEMPLATE_SETTING } from "./mirror/MirrorService.js";
import { FakeSheetsApi, GoogleSheetsApi, type SheetsApi } from "./mirror/SheetsApi.js";
import { buildApp } from "./app.js";

const PORT = Number(process.env.PORT ?? 8080);
const DB_PATH = process.env.DB_PATH ?? "./data/signoff.db";
const SERVICE_ACCOUNT_PATH = process.env.GOOGLE_SERVICE_ACCOUNT_JSON_PATH;
const SPREADSHEET_ID = process.env.SPREADSHEET_ID || null;
const WEB_DIST_PATH = process.env.WEB_DIST_PATH ?? join(process.cwd(), "web-dist");
const TRUST_PROXY = process.env.TRUST_PROXY === "true";

async function main() {
  mkdirSync(dirname(resolve(DB_PATH)), { recursive: true });
  console.log(`Database: ${resolve(DB_PATH)}`);

  // The one line that picks the storage engine — everything else only knows the Store interface.
  const store = new SqliteStore(DB_PATH);

  const auth = new AuthService(store);
  const catalog = new CatalogService(store);
  const signoffs = new SignoffService(store);

  const bootstrap = await auth.ensureBootstrapAdmin(process.env.BOOTSTRAP_ADMIN_USERNAME ?? "admin", process.env.BOOTSTRAP_ADMIN_PASSWORD || undefined);
  if (bootstrap) {
    console.log(`\nBOOTSTRAP ADMIN CREATED — shown once, save it now:\n  username: ${bootstrap.username}\n  password: ${bootstrap.password}\n`);
    if ((await catalog.listTemplates()).length === 0) {
      const seed = await catalog.createTemplate(mechanismChecklistSeed());
      // Remembered so a disaster-recovery restore can drop it again if it was never used.
      await store.settings.set(SEED_TEMPLATE_SETTING, seed.id);
    }
  }

  let sheetsApi: SheetsApi | null = null;
  if (SERVICE_ACCOUNT_PATH) sheetsApi = new GoogleSheetsApi(SERVICE_ACCOUNT_PATH);
  else if (process.env.FAKE_SHEETS === "true") sheetsApi = new FakeSheetsApi();
  else console.log("GOOGLE_SERVICE_ACCOUNT_JSON_PATH not set — Google Sheets backup mirror disabled.");

  const mirror = new MirrorService(store, sheetsApi, SPREADSHEET_ID);
  mirror.start();

  const app = await buildApp({ store, auth, catalog, signoffs, mirror }, { webDistPath: WEB_DIST_PATH, logger: true, trustProxy: TRUST_PROXY });
  await app.listen({ port: PORT, host: "0.0.0.0" });

  const shutdown = async () => {
    mirror.stop();
    await app.close();
    await store.close();
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
