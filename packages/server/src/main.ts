import { SignoffTypesService } from "./services/signoffTypes.js";
import { mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { SqliteStore } from "./store/sqlite/SqliteStore.js";
import { AuthService } from "./services/auth.js";
import { CatalogService, mechanismChecklistSeed } from "./services/catalog.js";
import { SignoffService } from "./services/signoffs.js";
import { PhotoFiles } from "./services/photoFiles.js";
import { MirrorService, SEED_TEMPLATE_SETTING } from "./mirror/MirrorService.js";
import { FakeSheetsApi, GoogleSheetsApi, type SheetsApi } from "./mirror/SheetsApi.js";
import { buildApp } from "./app.js";
import { PIN_PATTERN } from "@biosite-signoff/shared";

const PORT = Number(process.env.PORT ?? 8080);
const DB_PATH = process.env.DB_PATH ?? "./data/signoff.db";
const SERVICE_ACCOUNT_PATH = process.env.GOOGLE_SERVICE_ACCOUNT_JSON_PATH;
const SPREADSHEET_ID = process.env.SPREADSHEET_ID || null;
const WEB_DIST_PATH = process.env.WEB_DIST_PATH ?? join(process.cwd(), "web-dist");
const TRUST_PROXY = process.env.TRUST_PROXY === "true";
// Photo files (JPEG) — by default a `photos` folder next to the database, i.e. inside the NAS's
// bind-mounted data folder, created automatically.
const PHOTOS_PATH = process.env.PHOTOS_PATH || join(dirname(resolve(DB_PATH)), "photos");

async function main() {
  mkdirSync(dirname(resolve(DB_PATH)), { recursive: true });
  console.log(`Database: ${resolve(DB_PATH)}`);

  // The one line that picks the storage engine — everything else only knows the Store interface.
  const store = new SqliteStore(DB_PATH);

  const auth = new AuthService(store, { failureDelayMs: 1000 });
  const catalog = new CatalogService(store);
  const signoffTypes = new SignoffTypesService(store);
  mkdirSync(PHOTOS_PATH, { recursive: true });
  console.log(`Photos: ${resolve(PHOTOS_PATH)}`);
  const signoffs = new SignoffService(store, signoffTypes, new PhotoFiles(PHOTOS_PATH));

  // ADMIN_NAME / ADMIN_PIN from docker-compose.yml — only used on the very first start (empty
  // database); after that the admin changes their PIN in the app (Setup → My account).
  const adminName = (process.env.ADMIN_NAME ?? process.env.BOOTSTRAP_ADMIN_NAME ?? "").trim() || "Administrator";
  const adminPin = (process.env.ADMIN_PIN ?? process.env.BOOTSTRAP_ADMIN_PIN ?? "").trim() || undefined;
  if (adminPin && !PIN_PATTERN.test(adminPin)) {
    throw new Error(`ADMIN_PIN in docker-compose.yml must be 4–8 digits (got "${adminPin}").`);
  }
  if (process.env.ADMIN_RESET?.trim().toLowerCase() === "yes") {
    if (!adminPin) throw new Error('ADMIN_RESET is "yes" but ADMIN_PIN is empty — put the new PIN in ADMIN_PIN.');
    await auth.resetAdmin(adminName, adminPin);
    console.log(`\nADMIN RESET: "${adminName}" now signs in with ADMIN_PIN and is unlocked. Set ADMIN_RESET back to "no".\n`);
  }
  const bootstrap = await auth.ensureBootstrapAdmin(adminName, adminPin);
  if (bootstrap) {
    console.log(
      adminPin
        ? `\nADMIN CREATED: tap "${bootstrap.name}" on the sign-in screen and use the ADMIN_PIN from docker-compose.yml.\n`
        : `\nADMIN CREATED — shown once, save it now:\n  tap: ${bootstrap.name}\n  PIN: ${bootstrap.pin}\n`,
    );
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

  const app = await buildApp({ store, auth, catalog, signoffs, signoffTypes, mirror }, { webDistPath: WEB_DIST_PATH, logger: true, trustProxy: TRUST_PROXY });
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
