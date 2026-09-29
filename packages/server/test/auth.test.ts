import { describe, expect, it } from "vitest";
import { setup } from "./helpers.js";

describe("PIN sign-in", () => {
  it("lists users publicly (names only) for the sign-in tiles", async () => {
    const t = await setup();
    const res = await t.app.inject({ method: "GET", url: "/api/auth/users" });
    expect(res.statusCode).toBe(200);
    expect(res.json().map((u: { name: string }) => u.name)).toEqual(["Admin", "Olga Operator", "Otto"]);
    expect(Object.keys(res.json()[0]).sort()).toEqual(["id", "lockedUntil", "name"]);
  });

  it("locks an account for 5 minutes after 3 wrong PINs, then lets it in again", async () => {
    let now = Date.parse("2026-09-29T10:00:00Z");
    const t = await setup({ now: () => now });
    expect((await t.login("op", "0000")).res.json()).toMatchObject({ error: "INVALID_PIN", attemptsLeft: 2 });
    expect((await t.login("op", "0000")).res.json()).toMatchObject({ error: "INVALID_PIN", attemptsLeft: 1 });
    const third = (await t.login("op", "0000")).res.json();
    expect(third.error).toBe("TEMP_LOCKED");
    expect(third.retryAt).toBe("2026-09-29T10:05:00.000Z");
    // Even the right PIN is refused while locked, and the tile shows the lock.
    expect((await t.login("op", "2222")).res.json().error).toBe("TEMP_LOCKED");
    const tiles = (await t.app.inject({ method: "GET", url: "/api/auth/users" })).json();
    expect(tiles.find((u: { name: string }) => u.name === "Olga Operator").lockedUntil).toBe(third.retryAt);
    now += 5 * 60_000 + 1;
    expect((await t.login("op", "2222")).res.statusCode).toBe(200);
  });

  it("escalates to a hard lock after 5 lockouts in a row; an admin unlocks", async () => {
    let now = Date.parse("2026-09-29T10:00:00Z");
    const t = await setup({ now: () => now });
    for (let lockout = 0; lockout < 5; lockout++) {
      for (let i = 0; i < 3; i++) await t.login("op", "0000", `9.9.9.${lockout}`); // fresh IP each round, so the IP guard isn't what stops it
      now += 5 * 60_000 + 1;
    }
    expect((await t.login("op", "2222", "8.8.8.8")).res.json().error).toBe("LOCKED_OUT");
    const tiles = (await t.app.inject({ method: "GET", url: "/api/auth/users" })).json();
    expect(tiles.some((u: { name: string }) => u.name === "Olga Operator")).toBe(false);
    const admin = await t.login("admin", "1111", "5.5.5.5");
    await t.as(admin.token, "5.5.5.5")("PATCH", `/api/users/${t.ids.op}`, { locked: false });
    expect((await t.login("op", "2222", "8.8.8.8")).res.statusCode).toBe(200);
  });

  it("blocks an IP that guesses PINs across many accounts", async () => {
    const t = await setup();
    const ip = "6.6.6.6";
    // Straight at the service: over HTTP the per-IP route rate limit (10/min) would already stop
    // this burst — the guard is the layer that still holds for a bot that paces itself.
    for (const alias of ["op", "op2", "admin"]) for (let i = 0; i < 3; i++) await t.auth.login(t.ids[alias]!, "0000", ip);
    await t.auth.login(t.ids.op!, "0000", ip);
    const blocked = await t.auth.login(t.ids.op!, "2222", ip);
    expect(blocked).toMatchObject({ ok: false, reason: "IP_BLOCKED" });
    // Other IPs are unaffected (Otto's own lock aside).
    expect((await t.login("op2", "3333", "7.7.7.7")).res.json().error).toBe("TEMP_LOCKED");
  });

  it("refuses a second IP while a live session exists on the first", async () => {
    const t = await setup();
    expect((await t.login("op", "2222", "1.1.1.1")).res.statusCode).toBe(200);
    expect((await t.login("op", "2222", "1.1.1.1")).res.statusCode).toBe(200);
    const b = await t.login("op", "2222", "2.2.2.2");
    expect(b.res.json().error).toBe("ACTIVE_ON_ANOTHER_IP");
    expect((await t.login("op", "0000", "2.2.2.2")).res.json().error).toBe("INVALID_PIN");
  });

  it("logging out frees the account for another IP", async () => {
    const t = await setup();
    const a = await t.login("op", "2222", "1.1.1.1");
    await t.as(a.token, "1.1.1.1")("POST", "/api/auth/logout");
    expect((await t.login("op", "2222", "2.2.2.2")).res.statusCode).toBe(200);
  });

  it("kills a session used from a different IP than it was issued to", async () => {
    const t = await setup();
    const a = await t.login("op", "2222", "1.1.1.1");
    expect((await t.as(a.token, "1.1.1.1")("GET", "/api/auth/me")).statusCode).toBe(200);
    expect((await t.as(a.token, "9.9.9.9")("GET", "/api/auth/me")).statusCode).toBe(401);
    expect((await t.as(a.token, "1.1.1.1")("GET", "/api/auth/me")).statusCode).toBe(401);
    expect((await t.login("op", "2222", "9.9.9.9")).res.statusCode).toBe(200);
  });

  it("admin creates users with a PIN, resets PINs, deletes users; operators can't", async () => {
    const t = await setup();
    const admin = await t.login("admin", "1111", "5.5.5.5");
    const call = t.as(admin.token, "5.5.5.5");
    const created = (await call("POST", "/api/users", { name: "Piotr", role: "operator", pin: "4567" })).json();
    expect(created.pin).toBe("4567");
    expect((await call("POST", "/api/users", { name: "piotr", role: "operator", pin: "1234" })).json().error).toBe("NAME_TAKEN");
    expect((await call("POST", "/api/users", { name: "X", role: "operator", pin: "12" })).statusCode).toBe(400);
    expect((await t.login(created.id, "4567", "4.4.4.4")).res.statusCode).toBe(200);
    const reset = (await call("POST", `/api/users/${created.id}/pin`, {})).json();
    expect(reset.pin).toMatch(/^\d{6}$/);
    await call("DELETE", `/api/users/${created.id}`);
    expect((await t.app.inject({ method: "GET", url: "/api/auth/users" })).json().some((u: { name: string }) => u.name === "Piotr")).toBe(false);
    const op = await t.login("op", "2222", "1.1.1.1");
    expect((await t.as(op.token, "1.1.1.1")("POST", "/api/users", { name: "Y", role: "admin" })).statusCode).toBe(403);
  });

  it("single-IP can be switched off by an admin", async () => {
    const t = await setup();
    const admin = await t.login("admin", "1111", "5.5.5.5");
    expect((await t.as(admin.token, "5.5.5.5")("PATCH", "/api/security", { singleIp: false })).json().singleIp).toBe(false);
    await t.login("op", "2222", "1.1.1.1");
    expect((await t.login("op", "2222", "2.2.2.2")).res.statusCode).toBe(200);
  });
});

describe("document settings", () => {
  it("defaults, admin-only updates, mirrored", async () => {
    const t = await setup();
    const admin = await t.login("admin", "1111");
    const call = t.as(admin.token);
    const d = (await call("GET", "/api/document-settings")).json();
    expect(d.companyName).toBe("Biosite Systems Ltd.");
    const next = { ...d, address: "Unit 1\nNew Street\nB1 1AA", companyName: "Biosite Ltd" };
    expect((await call("PUT", "/api/document-settings", next)).json().address).toBe("Unit 1\nNew Street\nB1 1AA");
    expect((await call("PUT", "/api/document-settings", { ...next, logoDataUrl: "javascript:alert(1)" })).statusCode).toBe(400);
    await t.mirror.flush();
    expect(JSON.stringify(t.sheets.tabs.get("sheet-1/app_settings"))).toContain("New Street");
    const op = await t.login("op", "2222", "1.1.1.1");
    expect((await t.as(op.token, "1.1.1.1")("PUT", "/api/document-settings", next)).statusCode).toBe(403);
  });
});

describe("docker-compose admin", () => {
  it("bootstrap uses the configured name and PIN; ADMIN_RESET recovers a locked admin", async () => {
    const { SqliteStore } = await import("../src/store/sqlite/SqliteStore.js");
    const { AuthService } = await import("../src/services/auth.js");
    const store = new SqliteStore(":memory:");
    const auth = new AuthService(store);
    expect(await auth.ensureBootstrapAdmin("Marcin", "2468")).toEqual({ name: "Marcin", pin: "2468" });
    expect(await auth.ensureBootstrapAdmin("Marcin", "9999")).toBeNull(); // only on an empty database
    const [admin] = await auth.loginUsers();
    for (let i = 0; i < 3; i++) await auth.login(admin!.id, "0000", "1.1.1.1");
    expect(await auth.login(admin!.id, "2468", "1.1.1.2")).toMatchObject({ ok: false, reason: "TEMP_LOCKED" });
    await auth.resetAdmin("marcin", "1357");
    expect(await auth.login(admin!.id, "1357", "1.1.1.2")).toMatchObject({ ok: true, role: "admin" });
  });
});
