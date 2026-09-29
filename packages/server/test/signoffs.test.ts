import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { Signoff } from "@biosite-signoff/shared";
import { setup } from "./helpers.js";

const SIG = "M10 10L50 60L90 20";
const today = "2026-09-29";

describe("sign-off flow", () => {
  it("marks, refuses signing an incomplete check, signs, then locks the column", async () => {
    const t = await setup();
    const { token } = await t.login("op", "op-pass");
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
    const other = await t.login("op2", "op2-pass");
    const call2 = t.as(other.token);
    await call2("POST", `/api/signoffs/${id}/marks/fill`, { checkId: second!.id, value: "pass" });
    await call2("PUT", `/api/signoffs/${id}/signatures/${second!.id}`, { path: SIG, date: today });
    const list = (await call("GET", "/api/signoffs?status=complete")).json() as { items: { id: string; progress: string }[] };
    expect(list.items).toMatchObject([{ id, progress: "2/2" }]);

    // Someone else's signature can't be overwritten or removed by an operator.
    expect((await call("PUT", `/api/signoffs/${id}/signatures/${second!.id}`, { path: SIG, date: today })).json().error).toBe("ALREADY_SIGNED");
    expect((await call("DELETE", `/api/signoffs/${id}/signatures/${second!.id}`)).statusCode).toBe(403);
  });

  it("enforces distinct signers when the template asks for it", async () => {
    const t = await setup();
    const tpl = await t.catalog.updateTemplate(t.template.id, { ...t.template, distinctSigners: true });
    const { token } = await t.login("op", "op-pass");
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
    const { token } = await t.login("op", "op-pass");
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
    const { token } = await t.login("op", "op-pass");
    const id = randomUUID();
    await t.as(token)("POST", "/api/signoffs", { id, templateId: t.template.id, serialNumber: "F", mode: "new" });
    await t.catalog.updateTemplate(t.template.id, { ...t.template, checks: [...t.template.checks, { id: "c3", label: "3rd Check" }] });
    expect(((await t.as(token)("GET", `/api/signoffs/${id}`)).json() as Signoff).template.checks).toHaveLength(2);
  });
});
