import { describe, expect, it } from "vitest";
import { setup } from "./helpers.js";

describe("auth", () => {
  it("locks an account after 3 bad passwords", async () => {
    const t = await setup();
    for (let i = 0; i < 2; i++) expect((await t.login("op", "nope")).res.json().error).toBe("INVALID_CREDENTIALS");
    expect((await t.login("op", "nope")).res.json().error).toBe("LOCKED_OUT");
    expect((await t.login("op", "op-pass")).res.json().error).toBe("LOCKED_OUT");
  });

  it("refuses a second IP while a live session exists on the first", async () => {
    const t = await setup();
    const a = await t.login("op", "op-pass", "1.1.1.1");
    expect(a.res.statusCode).toBe(200);
    // Same IP (another device behind the same router) is fine.
    expect((await t.login("op", "op-pass", "1.1.1.1")).res.statusCode).toBe(200);
    const b = await t.login("op", "op-pass", "2.2.2.2");
    expect(b.res.statusCode).toBe(401);
    expect(b.res.json().error).toBe("ACTIVE_ON_ANOTHER_IP");
    // A wrong password from the other IP must not reveal that.
    expect((await t.login("op", "wrong", "2.2.2.2")).res.json().error).toBe("INVALID_CREDENTIALS");
  });

  it("logging out frees the account for another IP", async () => {
    const t = await setup();
    const a = await t.login("op", "op-pass", "1.1.1.1");
    const b = await t.login("op", "op-pass", "1.1.1.1");
    await t.as(a.token, "1.1.1.1")("POST", "/api/auth/logout");
    await t.as(b.token, "1.1.1.1")("POST", "/api/auth/logout");
    expect((await t.login("op", "op-pass", "2.2.2.2")).res.statusCode).toBe(200);
  });

  it("kills a session used from a different IP than it was issued to", async () => {
    const t = await setup();
    const a = await t.login("op", "op-pass", "1.1.1.1");
    expect((await t.as(a.token, "1.1.1.1")("GET", "/api/auth/me")).statusCode).toBe(200);
    expect((await t.as(a.token, "9.9.9.9")("GET", "/api/auth/me")).statusCode).toBe(401);
    // ...and it stays dead even back on the original IP.
    expect((await t.as(a.token, "1.1.1.1")("GET", "/api/auth/me")).statusCode).toBe(401);
    // The user can sign in again from the new network.
    expect((await t.login("op", "op-pass", "9.9.9.9")).res.statusCode).toBe(200);
  });

  it("single-IP can be switched off by an admin", async () => {
    const t = await setup();
    const admin = await t.login("admin", "admin-pass", "5.5.5.5");
    expect((await t.as(admin.token, "5.5.5.5")("PATCH", "/api/security", { singleIp: false })).json().singleIp).toBe(false);
    await t.login("op", "op-pass", "1.1.1.1");
    expect((await t.login("op", "op-pass", "2.2.2.2")).res.statusCode).toBe(200);
  });

  it("admin can end another user's sessions; operators can't reach admin routes", async () => {
    const t = await setup();
    const admin = await t.login("admin", "admin-pass", "5.5.5.5");
    const op = await t.login("op", "op-pass", "1.1.1.1");
    expect((await t.as(op.token, "1.1.1.1")("GET", "/api/users")).statusCode).toBe(403);
    const users = (await t.as(admin.token, "5.5.5.5")("GET", "/api/users")).json() as { id: string; username: string }[];
    const opId = users.find((u) => u.username === "op")!.id;
    await t.as(admin.token, "5.5.5.5")("POST", `/api/users/${opId}/end-sessions`);
    expect((await t.as(op.token, "1.1.1.1")("GET", "/api/auth/me")).statusCode).toBe(401);
  });
});
