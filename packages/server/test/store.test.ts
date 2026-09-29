import { describe, expect, it } from "vitest";
import { SqliteStore } from "../src/store/sqlite/SqliteStore.js";
import { TABLES } from "../src/store/schema.js";
import { FAKE_JPEG_URL, setup } from "./helpers.js";

describe("Store generic table access", () => {
  it("round-trips every mirrored table through readRows/importRows", async () => {
    const t = await setup();
    const { token } = await t.login("op", "2222");
    await t.store.appSettings.set("document", JSON.stringify({ companyName: "X" }));
    const part = await t.catalog.createPart({ partNumber: "P", name: "Part", description: "d" });
    await t.catalog.updateTemplate(t.template.id, { ...t.template, partIds: [part.id] });
    const id = crypto.randomUUID();
    const call = t.as(token);
    await call("POST", "/api/signoffs", { id, templateId: t.template.id, serialNumber: "S", mode: "service" });
    await call("POST", `/api/signoffs/${id}/marks/fill`, { checkId: t.template.checks[0]!.id, value: "pass" });
    await call("PUT", `/api/signoffs/${id}/signatures/${t.template.checks[0]!.id}`, { path: "M10 10L90 60L150 20", date: "2026-01-01" });
    await call("PUT", `/api/signoffs/${id}/parts/${crypto.randomUUID()}`, { partId: part.id, qty: 1 });
    await call("POST", `/api/signoffs/${id}/photos`, { photoId: crypto.randomUUID(), checkId: t.template.checks[0]!.id, dataUrl: FAKE_JPEG_URL });

    const copy = new SqliteStore(":memory:");
    for (const spec of TABLES) {
      const rows = await t.store.tables.readRows(spec.name);
      expect(rows.length, spec.name).toBeGreaterThan(0);
      for (const r of rows) expect(Object.keys(r)).toEqual([...spec.columns]);
      await copy.tables.importRows(spec.name, rows);
      if (spec.name !== "users") expect(await copy.tables.readRows(spec.name)).toEqual(rows);
    }
    const a = await t.store.signoffs.get(id);
    const b = await copy.signoffs.get(id);
    expect(b).toEqual(a);
  });
});
