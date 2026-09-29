import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { Signoff } from "@biosite-signoff/shared";
import { setup } from "./helpers.js";

const SIG = "M10 10L50 60L90 20";
const today = "2026-09-29";

describe("sign-off flow", () => {
  it("marks, refuses signing an incomplete check, signs, then locks the column", async () => {
    const t = await setup();
    const { token } = await t.login("op", "2222");
    const call = t.as(token);
    const id = randomUUID();
    const created = (await call("POST", "/api/signoffs", { id, templateId: t.template.id, serialNumber: "MX-001", mode: "new" })).json() as Signoff;
    expect(created.number).toBe("SO-000001");
    expect(created.template.rows).toHaveLength(16);
    // Retried create is idempotent.
    expect(((await call("POST", "/api/signoffs", { id, templateId: t.template.id, serialNumber: "MX-001", mode: "new" })).json() as Signoff).number).toBe("SO-000001");

    const [first, second] = created.template.checks;
    const items = created.template.rows.filter((r) => r.kind === "item");
    const section = created.template.rows.find((r) => r.kind === "section")!;

    await call("PUT", `/api/signoffs/${id}/marks`, { rowId: items[0]!.id, checkId: first!.id, value: "pass" });
    expect((await call("PUT", `/api/signoffs/${id}/marks`, { rowId: section.id, checkId: first!.id, value: "pass" })).statusCode).toBe(400);

    const early = await call("PUT", `/api/signoffs/${id}/signatures/${first!.id}`, { path: SIG, date: today });
    expect(early.statusCode).toBe(409);
    expect(early.json().error).toBe("CHECK_INCOMPLETE");

    await call("POST", `/api/signoffs/${id}/marks/fill`, { checkId: first!.id, value: "pass" });
    const signed = (await call("PUT", `/api/signoffs/${id}/signatures/${first!.id}`, { path: SIG, date: today })).json() as Signoff;
    expect(signed.signatures[0]).toMatchObject({ checkId: first!.id, name: "Olga Operator", date: today });

    const locked = await call("PUT", `/api/signoffs/${id}/marks`, { rowId: items[1]!.id, checkId: first!.id, value: "fail" });
    expect(locked.json().error).toBe("CHECK_SIGNED");

    // Second check by someone else completes it.
    const other = await t.login("op2", "3333");
    const call2 = t.as(other.token);
    await call2("POST", `/api/signoffs/${id}/marks/fill`, { checkId: second!.id, value: "pass" });
    await call2("PUT", `/api/signoffs/${id}/signatures/${second!.id}`, { path: SIG, date: today });
    const list = (await call("GET", "/api/signoffs?status=complete")).json() as { items: { id: string; progress: string }[] };
    expect(list.items).toMatchObject([{ id, progress: "2/2" }]);

    // Someone else's signature can't be overwritten or removed by an operator.
    expect((await call("PUT", `/api/signoffs/${id}/signatures/${second!.id}`, { path: SIG, date: today })).json().error).toBe("ALREADY_SIGNED");
    expect((await call("DELETE", `/api/signoffs/${id}/signatures/${second!.id}`)).statusCode).toBe(403);
  });

  it("spreads checks over the operators (cross-check); admins are exempt", async () => {
    const t = await setup();
    const four = await t.catalog.updateTemplate(t.template.id, {
      ...t.template,
      checks: [1, 2, 3, 4].map((n) => ({ id: `c${n}`, label: `Check ${n}` })),
    });
    const a = t.as((await t.login("op", "2222")).token);
    const b = t.as((await t.login("op2", "3333")).token);
    const sign = (call: typeof a, id: string, n: number) => call("PUT", `/api/signoffs/${id}/signatures/c${n}`, { path: SIG, date: today });
    const start = async (call: typeof a) => {
      const id = randomUUID();
      await call("POST", "/api/signoffs", { id, templateId: four.id, serialNumber: `X-${id.slice(0, 4)}`, mode: "new" });
      for (const c of four.checks) await call("POST", `/api/signoffs/${id}/marks/fill`, { checkId: c.id, value: "pass" });
      return id;
    };

    // 2 operators × 4 checks → at most 2 each.
    const id = await start(a);
    expect((await sign(a, id, 1)).statusCode).toBe(200);
    expect((await sign(a, id, 2)).statusCode).toBe(200);
    expect((await sign(a, id, 3)).json().error).toBe("CROSS_CHECK");
    expect((await sign(b, id, 3)).statusCode).toBe(200);
    expect((await sign(b, id, 4)).statusCode).toBe(200);

    // 2 operators × 2 checks → strictly crossed.
    await t.catalog.updateTemplate(four.id, { ...four, checks: four.checks.slice(0, 2) });
    const id2 = await start(a);
    expect((await sign(a, id2, 1)).statusCode).toBe(200);
    expect((await sign(a, id2, 2)).json().error).toBe("CROSS_CHECK");

    // An admin can sign any number of checks.
    const admin = t.as((await t.login("admin", "1111")).token);
    const id3 = await start(admin);
    expect((await sign(admin, id3, 1)).statusCode).toBe(200);
    expect((await sign(admin, id3, 2)).statusCode).toBe(200);

    // A lone operator signs everything.
    expect((await admin("DELETE", `/api/users/${t.ids.op2}`)).statusCode).toBe(200);
    expect((await sign(a, id2, 2)).statusCode).toBe(200);
  });

  it("lists in-progress sign-offs above completed ones", async () => {
    const t = await setup();
    const admin = t.as((await t.login("admin", "1111")).token);
    const ids = [randomUUID(), randomUUID(), randomUUID()];
    for (const [i, id] of ids.entries()) await admin("POST", "/api/signoffs", { id, templateId: t.template.id, serialNumber: `L-${i}`, mode: "new" });
    // Complete the newest one; it drops below the older in-progress ones.
    for (const c of t.template.checks) {
      await admin("POST", `/api/signoffs/${ids[2]}/marks/fill`, { checkId: c.id, value: "pass" });
      await admin("PUT", `/api/signoffs/${ids[2]}/signatures/${c.id}`, { path: SIG, date: today });
    }
    const order = () => admin("GET", "/api/signoffs").then((r) => (r.json() as { items: { id: string }[] }).items.map((x) => x.id));
    expect(await order()).toEqual([ids[1], ids[0], ids[2]]);
    // Taking a signature back makes it in progress again — back to the top.
    await admin("DELETE", `/api/signoffs/${ids[2]}/signatures/${t.template.checks[1]!.id}`);
    expect(await order()).toEqual([ids[2], ids[1], ids[0]]);
  });

  it("enforces distinct signers when the template asks for it", async () => {
    const t = await setup();
    const tpl = await t.catalog.updateTemplate(t.template.id, { ...t.template, distinctSigners: true });
    const { token } = await t.login("op", "2222");
    const call = t.as(token);
    const id = randomUUID();
    await call("POST", "/api/signoffs", { id, templateId: tpl.id, serialNumber: "X", mode: "new" });
    for (const c of tpl.checks) await call("POST", `/api/signoffs/${id}/marks/fill`, { checkId: c.id, value: "pass" });
    expect((await call("PUT", `/api/signoffs/${id}/signatures/${tpl.checks[0]!.id}`, { path: SIG, date: today })).statusCode).toBe(200);
    expect((await call("PUT", `/api/signoffs/${id}/signatures/${tpl.checks[1]!.id}`, { path: SIG, date: today })).json().error).toBe("SAME_SIGNER");
  });

  it("records replaced parts only on service sign-offs, only from the template's list", async () => {
    const t = await setup();
    const spring = await t.catalog.createPart({ partNumber: "SP-01", name: "Plunger spring", description: "" });
    const bolt = await t.catalog.createPart({ partNumber: "BT-02", name: "Cam bolt", description: "" });
    await t.catalog.updateTemplate(t.template.id, { ...t.template, partIds: [spring.id] });
    const { token } = await t.login("op", "2222");
    const call = t.as(token);

    const newId = randomUUID();
    await call("POST", "/api/signoffs", { id: newId, templateId: t.template.id, serialNumber: "N-1", mode: "new" });
    expect((await call("PUT", `/api/signoffs/${newId}/parts/${randomUUID()}`, { partId: spring.id, qty: 1 })).json().error).toBe("NOT_SERVICE");

    const svcId = randomUUID();
    await call("POST", "/api/signoffs", { id: svcId, templateId: t.template.id, serialNumber: "S-1", mode: "service" });
    const line = randomUUID();
    const withPart = (await call("PUT", `/api/signoffs/${svcId}/parts/${line}`, { partId: spring.id, qty: 2, note: "worn" })).json() as Signoff;
    expect(withPart.parts).toMatchObject([{ id: line, partNumber: "SP-01", name: "Plunger spring", qty: 2, note: "worn" }]);
    expect((await call("PUT", `/api/signoffs/${svcId}/parts/${randomUUID()}`, { partId: bolt.id, qty: 1 })).statusCode).toBe(400);

    // Renaming the part later doesn't rewrite the recorded snapshot.
    await t.catalog.updatePart(spring.id, { name: "Spring v2" });
    expect(((await call("GET", `/api/signoffs/${svcId}`)).json() as Signoff).parts[0]!.name).toBe("Plunger spring");

    expect((await call("PATCH", `/api/signoffs/${svcId}`, { mode: "new" })).json().error).toBe("HAS_PARTS");
    await call("DELETE", `/api/signoffs/${svcId}/parts/${line}`);
    expect(((await call("PATCH", `/api/signoffs/${svcId}`, { mode: "new" })).json() as Signoff).mode).toBe("new");
  });

  it("freezes the template on the sign-off", async () => {
    const t = await setup();
    const { token } = await t.login("op", "2222");
    const id = randomUUID();
    await t.as(token)("POST", "/api/signoffs", { id, templateId: t.template.id, serialNumber: "F", mode: "new" });
    await t.catalog.updateTemplate(t.template.id, { ...t.template, checks: [...t.template.checks, { id: "c3", label: "3rd Check" }] });
    expect(((await t.as(token)("GET", `/api/signoffs/${id}`)).json() as Signoff).template.checks).toHaveLength(2);
  });
});

describe("sign-off types", () => {
  it("defaults to New (UK) / New (USA) / Service; admin edits them; records keep their type name", async () => {
    const t = await setup();
    const admin = await t.login("admin", "1111");
    const call = t.as(admin.token);
    const types = (await call("GET", "/api/signoff-types")).json();
    expect(types.map((x: { name: string }) => x.name)).toEqual(["New (UK)", "New (USA)", "Service"]);

    const usa = randomUUID();
    const created = (await call("POST", "/api/signoffs", { id: usa, templateId: t.template.id, serialNumber: "U-1", typeId: "new-usa" })).json() as Signoff;
    expect(created).toMatchObject({ typeId: "new-usa", typeName: "New (USA)", mode: "new" });

    // Admin adds a type, renames one, reorders.
    const next = [
      { id: "service", name: "Service", description: "Repair", allowsParts: true },
      { id: "new-usa", name: "New (US)", description: "Check only", allowsParts: false },
      { id: "rework", name: "Rework", description: "Parts may change", allowsParts: true },
    ];
    expect((await call("PUT", "/api/signoff-types", next)).json().map((x: { name: string }) => x.name)).toEqual(["Service", "New (US)", "Rework"]);
    expect((await call("PUT", "/api/signoff-types", [])).statusCode).toBe(400);
    expect((await call("PUT", "/api/signoff-types", [next[0], { ...next[1], name: "service" }])).statusCode).toBe(400);

    // The existing record keeps the name it was created with.
    expect(((await call("GET", `/api/signoffs/${usa}`)).json() as Signoff).typeName).toBe("New (USA)");

    // Switching to a parts-allowing type enables parts; switching back with parts is refused.
    const part = await t.catalog.createPart({ partNumber: "P", name: "Spring", description: "" });
    await t.catalog.updateTemplate(t.template.id, { ...t.template, partIds: [part.id] });
    const svc = randomUUID();
    await call("POST", "/api/signoffs", { id: svc, templateId: t.template.id, serialNumber: "S-9", typeId: "new-usa" });
    expect((await call("PATCH", `/api/signoffs/${svc}`, { typeId: "rework" })).json()).toMatchObject({ typeName: "Rework", mode: "service" });
    await call("PUT", `/api/signoffs/${svc}/parts/${randomUUID()}`, { partId: part.id, qty: 1 });
    expect((await call("PATCH", `/api/signoffs/${svc}`, { typeId: "new-usa" })).json().error).toBe("HAS_PARTS");

    const filtered = (await call("GET", "/api/signoffs?typeId=rework")).json();
    expect(filtered.items.map((x: { typeName: string }) => x.typeName)).toEqual(["Rework"]);
  });
});

describe("parts available on a service sign-off", () => {
  it("every defined part when the checklist ticks none; narrowed (incl. later changes) when it does", async () => {
    const t = await setup();
    const admin = await t.login("admin", "1111");
    const call = t.as(admin.token);
    const id = randomUUID();
    await call("POST", "/api/signoffs", { id, templateId: t.template.id, serialNumber: "LATE-1", typeId: "service" });
    // Parts defined after the sign-off was started, none ticked on the checklist -> all allowed.
    const a = await t.catalog.createPart({ partNumber: "LP-1", name: "Late part", description: "" });
    const b = await t.catalog.createPart({ partNumber: "LP-2", name: "Other part", description: "" });
    const res = await call("PUT", `/api/signoffs/${id}/parts/${randomUUID()}`, { partId: a.id, qty: 2 });
    expect(res.statusCode).toBe(200);
    expect((res.json() as Signoff).parts).toMatchObject([{ name: "Late part", qty: 2 }]);
    // Admin narrows the checklist to part A only -> B is refused, even on this in-progress sign-off.
    await t.catalog.updateTemplate(t.template.id, { ...t.template, partIds: [a.id] });
    expect((await call("PUT", `/api/signoffs/${id}/parts/${randomUUID()}`, { partId: b.id, qty: 1 })).statusCode).toBe(400);
  });
});

describe("mechanism history (rotating serial numbers)", () => {
  it("keeps every visit of a serial with arrival, per-check date + time, departure; ✕ all clears a column", async () => {
    const t = await setup();
    const admin = await t.login("admin", "1111");
    const op2 = await t.login("op2", "3333");
    const [c1, c2] = t.template.checks;

    async function visit(arrivedAt: string, d1: [string, string], d2: [string, string] | null) {
      const id = randomUUID();
      await t.as(admin.token)("POST", "/api/signoffs", { id, templateId: t.template.id, serialNumber: "MX-77", typeId: "service", arrivedAt });
      await t.as(admin.token)("POST", `/api/signoffs/${id}/marks/fill`, { checkId: c1!.id, value: "pass" });
      await t.as(admin.token)("PUT", `/api/signoffs/${id}/signatures/${c1!.id}`, { path: SIG, date: d1[0], time: d1[1] });
      if (d2) {
        await t.as(op2.token)("POST", `/api/signoffs/${id}/marks/fill`, { checkId: c2!.id, value: "pass" });
        await t.as(op2.token)("PUT", `/api/signoffs/${id}/signatures/${c2!.id}`, { path: SIG, date: d2[0], time: d2[1] });
      }
      return id;
    }
    await visit("2026-08-01T07:00:00.000Z", ["2026-08-01", "09:15"], ["2026-08-01", "14:40"]);
    const second = await visit("2026-09-02T07:30:00.000Z", ["2026-09-02", "10:05"], null);

    // "✕ all" on the unsigned 2nd check: tick all, then clear all.
    await t.as(admin.token)("POST", `/api/signoffs/${second}/marks/fill`, { checkId: c2!.id, value: "pass" });
    const cleared = (await t.as(admin.token)("POST", `/api/signoffs/${second}/marks/clear`, { checkId: c2!.id })).json() as Signoff;
    expect(cleared.marks.filter((m) => m.checkId === c2!.id)).toHaveLength(0);
    // …but a signed column can't be cleared.
    expect((await t.as(admin.token)("POST", `/api/signoffs/${second}/marks/clear`, { checkId: c1!.id })).json().error).toBe("CHECK_SIGNED");

    const visits = (await t.as(admin.token)("GET", "/api/mechanisms/mx-77/visits")).json() as Signoff[];
    expect(visits.map((v) => v.arrivedAt)).toEqual(["2026-08-01T07:00:00.000Z", "2026-09-02T07:30:00.000Z"]);
    expect(visits[0]!.signatures.map((s) => `${s.date} ${s.time}`)).toEqual(expect.arrayContaining(["2026-08-01 09:15", "2026-08-01 14:40"]));

    const mechs = (await t.as(admin.token)("GET", "/api/mechanisms?q=MX-77")).json();
    expect(mechs).toMatchObject([{ serialNumber: "MX-77", visits: 2, atClient: false, last: { id: second, departedAt: null } }]);
    const list = (await t.as(admin.token)("GET", "/api/signoffs?q=MX-77&status=complete")).json();
    expect(list.items[0].departedAt).toBe("2026-08-01 14:40");
  });
});

describe("home screen stock tabs", () => {
  it("shows only first-check-done, not-yet-complete sign-offs per type, sorted as asked", async () => {
    const t = await setup();
    const admin = await t.login("admin", "1111");
    const call = t.as(admin.token);
    const [c1, c2] = t.template.checks;
    async function make(serial: string, typeId: string, firstAt: [string, string] | null, secondToo = false) {
      const id = randomUUID();
      await call("POST", "/api/signoffs", { id, templateId: t.template.id, serialNumber: serial, typeId });
      if (firstAt) {
        await call("POST", `/api/signoffs/${id}/marks/fill`, { checkId: c1!.id, value: "pass" });
        await call("PUT", `/api/signoffs/${id}/signatures/${c1!.id}`, { path: SIG, date: firstAt[0], time: firstAt[1] });
      }
      if (secondToo) {
        await call("POST", `/api/signoffs/${id}/marks/fill`, { checkId: c2!.id, value: "pass" });
        await call("PUT", `/api/signoffs/${id}/signatures/${c2!.id}`, { path: SIG, date: firstAt![0], time: "23:00" });
      }
    }
    await make("TB-9", "new-uk", ["2026-09-01", "08:00"]);
    await make("TB-10", "new-uk", ["2026-09-01", "09:00"]);
    await make("TB-11", "new-uk", null); // no first check yet -> not in stock
    await make("TB-12", "new-uk", ["2026-09-01", "10:00"], true); // second check done -> gone
    await make("SV-1", "service", ["2026-09-03", "07:00"]);
    await make("SV-2", "service", ["2026-09-05", "07:00"]);
    await make("SV-3", "service", ["2026-09-04", "07:00"]);

    expect(((await call("GET", "/api/stock/new-uk")).json() as { serialNumber: string }[]).map((s) => s.serialNumber)).toEqual(["TB-10", "TB-9"]);
    const svc = (await call("GET", "/api/stock/service")).json() as { serialNumber: string; firstCheckAt: string }[];
    expect(svc.map((s) => s.serialNumber)).toEqual(["SV-2", "SV-3", "SV-1"]);
    expect(svc[0]!.firstCheckAt).toBe("2026-09-05 07:00");
    expect((await call("GET", "/api/stock/new-usa")).json()).toEqual([]);
  });
});

describe("stock with more than two checks", () => {
  it("stays in stock through checks 1-3 of 4 and leaves only after the last one", async () => {
    const t = await setup();
    const checks = ["1st Check", "2nd Check", "3rd Check", "4th Check"].map((label) => ({ id: randomUUID(), label }));
    const tpl = await t.catalog.updateTemplate(t.template.id, { ...t.template, checks });
    const admin = await t.login("admin", "1111");
    const call = t.as(admin.token);
    const id = randomUUID();
    await call("POST", "/api/signoffs", { id, templateId: tpl.id, serialNumber: "TB-4C", typeId: "new-uk" });
    const inStock = async () => ((await call("GET", "/api/stock/new-uk")).json() as { serialNumber: string; progress: string }[]).find((s) => s.serialNumber === "TB-4C");
    expect(await inStock()).toBeUndefined();
    for (let i = 0; i < 4; i++) {
      await call("POST", `/api/signoffs/${id}/marks/fill`, { checkId: checks[i]!.id, value: "pass" });
      await call("PUT", `/api/signoffs/${id}/signatures/${checks[i]!.id}`, { path: SIG, date: "2026-09-10", time: `1${i}:00` });
      if (i < 3) expect((await inStock())?.progress).toBe(`${i + 1}/4`);
    }
    expect(await inStock()).toBeUndefined();
  });
});

describe("operator restrictions", () => {
  it("empty signatures refused; serial/arrival admin-only; signatures & deletes admin-only; completed sign-offs closed to operators", async () => {
    const t = await setup();
    const admin = t.as((await t.login("admin", "1111")).token);
    const op = t.as((await t.login("op", "2222", "10.0.0.1")).token);
    const [c1, c2] = t.template.checks;
    const id = randomUUID();
    await op("POST", "/api/signoffs", { id, templateId: t.template.id, serialNumber: "LOCK-1", typeId: "service" });

    // Empty / dot signature
    await op("POST", `/api/signoffs/${id}/marks/fill`, { checkId: c1!.id, value: "pass" });
    const dot = await op("PUT", `/api/signoffs/${id}/signatures/${c1!.id}`, { path: "M100 50L101 50", date: "2026-09-10", time: "10:00" });
    expect(dot.json().error).toBe("SIGNATURE_EMPTY");
    expect((await op("PUT", `/api/signoffs/${id}/signatures/${c1!.id}`, { path: SIG, date: "2026-09-10", time: "10:00" })).statusCode).toBe(200);

    // Serial / arrival: operator no, admin yes
    expect((await op("PATCH", `/api/signoffs/${id}`, { serialNumber: "HACK" })).statusCode).toBe(403);
    expect((await op("PATCH", `/api/signoffs/${id}`, { arrivedAt: "2026-01-01T00:00:00.000Z" })).statusCode).toBe(403);
    expect(((await admin("PATCH", `/api/signoffs/${id}`, { serialNumber: "LOCK-1A" })).json() as Signoff).serialNumber).toBe("LOCK-1A");

    // Signatures are permanent for operators — even their own
    expect((await op("DELETE", `/api/signoffs/${id}/signatures/${c1!.id}`)).statusCode).toBe(403);

    // Delete: admin-only by default; admin can open it to everyone
    expect((await op("DELETE", `/api/signoffs/${id}`)).statusCode).toBe(403);
    expect((await op("GET", "/api/permissions")).json()).toEqual({ deleteSignoffs: "admin" });
    expect((await op("PUT", "/api/permissions", { deleteSignoffs: "all" })).statusCode).toBe(403);

    // Complete it -> operators can't change parts/notes/type any more
    const part = await t.catalog.createPart({ partNumber: "P1", name: "Spring", description: "" });
    await op("POST", `/api/signoffs/${id}/marks/fill`, { checkId: c2!.id, value: "pass" });
    await admin("PUT", `/api/signoffs/${id}/signatures/${c2!.id}`, { path: SIG, date: "2026-09-10", time: "11:00" });
    expect((await op("PATCH", `/api/signoffs/${id}`, { notes: "late edit" })).json().error).toBe("COMPLETED");
    expect((await op("PUT", `/api/signoffs/${id}/parts/${randomUUID()}`, { partId: part.id, qty: 1 })).json().error).toBe("COMPLETED");
    expect((await admin("PATCH", `/api/signoffs/${id}`, { notes: "admin fix" })).statusCode).toBe(200);

    await admin("PUT", "/api/permissions", { deleteSignoffs: "all" });
    expect((await op("DELETE", `/api/signoffs/${id}`)).statusCode).toBe(200);
  });
});
