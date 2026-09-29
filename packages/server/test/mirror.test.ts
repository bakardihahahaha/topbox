import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { SqliteStore } from "../src/store/sqlite/SqliteStore.js";
import { MirrorService, SEED_TEMPLATE_SETTING } from "../src/mirror/MirrorService.js";
import { SheetTable } from "../src/mirror/SheetTable.js";
import { TABLES } from "../src/store/schema.js";
import { setup } from "./helpers.js";

describe("Google Sheets backup mirror", () => {
  it("pushes every write via the outbox, upserting by id", async () => {
    const t = await setup();
    expect(await t.store.outbox.count()).toBeGreaterThan(0);
    await t.mirror.flush();
    expect(await t.store.outbox.count()).toBe(0);
    const partsTab = () => t.sheets.tabs.get("sheet-1/parts") ?? [];

    const part = await t.catalog.createPart({ partNumber: "P-1", name: "Spring", description: "" });
    await t.mirror.flush();
    expect(partsTab()).toHaveLength(2); // header + 1
    await t.catalog.updatePart(part.id, { name: "Spring v2" });
    await t.mirror.flush();
    expect(partsTab()).toHaveLength(2); // overwritten in place, not appended
    expect(partsTab()[1]).toContain("Spring v2");
    await t.catalog.deletePart(part.id);
    await t.mirror.flush();
    expect(partsTab()[1]![partsTab()[0]!.indexOf("deleted_at")]).not.toBe("");
  });

  it("keeps changes queued and backs off when Google answers 429", async () => {
    const t = await setup();
    t.sheets.failNext(1);
    await expect(t.mirror.flush()).rejects.toBeTruthy();
    const status = await t.mirror.status();
    expect(status.pending).toBeGreaterThan(0);
    expect(status.lastError).toMatch(/quota/i);
    expect(status.backoffUntil).not.toBeNull();
    await t.mirror.flush(); // quota back
    expect((await t.mirror.status()).pending).toBe(0);
  });

  it("translates a Google 429 on an admin action into 503 RATE_LIMITED + retry-after", async () => {
    const t = await setup();
    const { token } = await t.login("admin", "1111");
    t.sheets.failNext(10);
    const res = await t.as(token)("POST", "/api/backup/sync-now");
    expect(res.statusCode).toBe(503);
    expect(res.json().error).toBe("RATE_LIMITED");
    expect(res.headers["retry-after"]).toBe("30");
    expect(JSON.stringify(res.json())).not.toMatch(/Quota exceeded/);
  });

  it("serves repeated tab reads from cache", async () => {
    const t = await setup();
    await t.mirror.flush();
    const table = new SheetTable(t.sheets, "sheet-1", "parts", 60_000);
    const before = t.sheets.calls.read;
    await Promise.all([table.readAll(), table.readAll(), table.readAll()]);
    await table.readAll();
    expect(t.sheets.calls.read - before).toBe(1);
  });

  it("sends a whole sync — many sign-offs, several tabs — as ONE write call", async () => {
    const t = await setup();
    t.mirror.stop(); // no automatic pushes in between — this test flushes by hand
    await t.mirror.flush(); // first sync (creates the tabs) — also one write
    const op = t.as((await t.login("op", "2222")).token);
    const first = t.template.checks[0]!;
    for (let i = 0; i < 20; i++) {
      const id = randomUUID();
      await op("POST", "/api/signoffs", { id, templateId: t.template.id, serialNumber: `B-${i}`, typeId: "new-uk" });
      await op("POST", `/api/signoffs/${id}/marks/fill`, { checkId: first.id, value: "pass" });
      await op("PUT", `/api/signoffs/${id}/signatures/${first.id}`, { path: "M10 10L90 60L150 20", date: "2026-09-29" });
    }
    const writes = t.sheets.calls.write;
    const reads = t.sheets.calls.read;
    const pushed = await t.mirror.flush();
    expect(pushed).toBe(20 * 17); // 20 × (sign-off + 15 marks + signature)
    expect(t.sheets.calls.write - writes).toBe(1);
    expect(t.sheets.calls.read - reads).toBeLessThanOrEqual(1);
    const signoffs = t.sheets.tabs.get("sheet-1/signoffs")!;
    expect(signoffs.length).toBe(21); // header + 20
    expect(t.sheets.tabs.get("sheet-1/signoff_signatures")!.length).toBe(21);

    // An update right after overwrites in place — still one write, and no re-read (cache holds
    // exactly what was written).
    await op("PATCH", `/api/signoffs/${signoffs[5]![0]}`, { notes: "scratch on the lid" });
    const w2 = t.sheets.calls.write;
    const r2 = t.sheets.calls.read;
    await t.mirror.flush();
    expect(t.sheets.calls.write - w2).toBe(1);
    expect(t.sheets.calls.read - r2).toBe(0);
    expect(t.sheets.tabs.get("sheet-1/signoffs")!.length).toBe(21);
    expect(JSON.stringify(t.sheets.tabs.get("sheet-1/signoffs")![5])).toContain("scratch on the lid");
  });

  it("restores a fresh database from the sheet", async () => {
    const t = await setup();
    const { token } = await t.login("op", "2222");
    const id = randomUUID();
    await t.as(token)("POST", "/api/signoffs", { id, templateId: t.template.id, serialNumber: "R-1", mode: "new" });
    await t.as(token)("POST", `/api/signoffs/${id}/marks/fill`, { checkId: t.template.checks[0]!.id, value: "pass" });
    await t.mirror.flush();

    const fresh = new SqliteStore(":memory:");
    const restorer = new MirrorService(fresh, t.sheets, "sheet-1");
    await restorer.restore();
    const restored = await fresh.signoffs.get(id);
    expect(restored?.serialNumber).toBe("R-1");
    expect(restored?.marks).toHaveLength(15);
    expect((await fresh.templates.list())[0]!.rows).toHaveLength(16);
    const op = await fresh.users.get(t.ids.op!);
    expect(op?.locked).toBe(true); // restored accounts need a password reset
    expect(await fresh.outbox.count()).toBe(0); // restore never re-mirrors
  });

  it("disaster recovery on a fresh install: seed template doesn't survive, restore allowed", async () => {
    const t = await setup();
    const { token } = await t.login("op", "2222");
    await t.as(token)("POST", "/api/signoffs", { id: randomUUID(), templateId: t.template.id, serialNumber: "D-1", mode: "new" });
    await t.mirror.flush();

    // A brand-new NAS database: bootstrap admin + seeded example template, pointed at the old sheet.
    const n = await setup();
    const seed = n.template;
    await n.store.settings.set(SEED_TEMPLATE_SETTING, seed.id);
    const mirror = new MirrorService(n.store, t.sheets, null);
    expect(await mirror.setSpreadsheetId("sheet-1")).toBe(false); // first sheet: no full re-copy needed
    await mirror.flush(); // the seed even reaches the old sheet before anyone presses restore
    await mirror.restore();
    const names = (await n.store.templates.list()).map((x) => x.id);
    expect(names).toContain(t.template.id);
    expect(names).not.toContain(seed.id);
    expect((await n.store.signoffs.list({ limit: 10, offset: 0 })).items.map((x) => x.serialNumber)).toEqual(["D-1"]);
  });
});

describe("instant mirror", () => {
  it("pushes a write to the sheet about a second after it lands, without waiting for the interval", async () => {
    const t = await setup();
    await t.mirror.flush();
    const admin = await t.login("admin", "1111");
    await t.as(admin.token)("POST", "/api/parts", { partNumber: "FAST-1", name: "Fast part", description: "" });
    await new Promise((r) => setTimeout(r, 1500));
    expect(JSON.stringify(t.sheets.tabs.get("sheet-1/parts"))).toContain("FAST-1");
    expect(await t.store.outbox.count()).toBe(0);
  });
});
