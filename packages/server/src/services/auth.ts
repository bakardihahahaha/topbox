import { randomBytes, randomUUID } from "node:crypto";
import type { Role } from "@biosite-signoff/shared";
import type { Store, UserRecord } from "../store/Store.js";
import { audit } from "./audit.js";
import { HttpError, badRequest, conflict, forbidden, notFound } from "./errors.js";
import { generatePassword, hashPassword, verifyPassword } from "./password.js";

const MAX_FAILED_ATTEMPTS = 3;
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const TOUCH_THROTTLE_MS = 60_000;
const DEFAULT_IDLE_MINUTES = 30;

export const IDLE_SETTING = "security.idle_timeout_minutes";
export const SINGLE_IP_SETTING = "security.single_ip";

export interface SecuritySettings {
  /** 0 = never. */
  idleTimeoutMinutes: number;
  /** One account = one IP at a time. A session only works from the IP it was created on, and
   * signing in from a second IP is refused while a live session exists on the first. */
  singleIp: boolean;
}

export interface UserSummary {
  id: string;
  username: string;
  name: string;
  role: Role;
  locked: boolean;
  activeSessions: { ip: string; lastActivityAt: string }[];
  createdAt: string;
}

export type LoginResult =
  | { ok: true; token: string; userId: string; role: Role }
  | { ok: false; reason: "INVALID_CREDENTIALS" | "LOCKED_OUT" | "ACTIVE_ON_ANOTHER_IP" };

export class AuthService {
  constructor(private readonly store: Store) {}

  async securitySettings(): Promise<SecuritySettings> {
    const idle = await this.store.settings.get(IDLE_SETTING);
    const single = await this.store.settings.get(SINGLE_IP_SETTING);
    return { idleTimeoutMinutes: idle === null ? DEFAULT_IDLE_MINUTES : Number(idle), singleIp: single === null ? true : single === "1" };
  }

  async setSecuritySettings(patch: Partial<SecuritySettings>, actorId: string): Promise<SecuritySettings> {
    if (patch.idleTimeoutMinutes !== undefined) {
      const m = patch.idleTimeoutMinutes;
      if (!Number.isInteger(m) || m < 0 || m > 1440) throw badRequest("Idle timeout must be 0 (off) or 1–1440 minutes.");
      await this.store.settings.set(IDLE_SETTING, String(m));
    }
    if (patch.singleIp !== undefined) await this.store.settings.set(SINGLE_IP_SETTING, patch.singleIp ? "1" : "0");
    await audit(this.store, { actorId, action: "WRITE", entity: "security_settings", detail: patch });
    return this.securitySettings();
  }

  /** A session counts as live if it's neither past its 12h lifetime nor idle-expired. */
  private isLive(s: { expiresAt: string; lastActivityAt: string }, idleMinutes: number, now: number): boolean {
    if (new Date(s.expiresAt).getTime() < now) return false;
    return !(idleMinutes > 0 && now - new Date(s.lastActivityAt).getTime() > idleMinutes * 60_000);
  }

  async login(username: string, password: string, ip: string): Promise<LoginResult> {
    const user = await this.store.users.getByUsername(username.trim());
    if (!user) {
      await audit(this.store, { actorId: null, action: "AUTH_FAIL", entity: "user", entityId: username, detail: { reason: "no such user" }, ip });
      return { ok: false, reason: "INVALID_CREDENTIALS" };
    }
    if (user.locked) {
      await audit(this.store, { actorId: user.id, action: "AUTH_FAIL", entity: "user", entityId: user.id, detail: { reason: "locked" }, ip });
      return { ok: false, reason: "LOCKED_OUT" };
    }
    if (!verifyPassword(password, user.passwordHash)) {
      const attempts = user.failedAttempts + 1;
      const locked = attempts >= MAX_FAILED_ATTEMPTS;
      await this.store.users.update(user.id, { failedAttempts: attempts, locked });
      if (locked) await this.store.sessions.deleteForUser(user.id);
      await audit(this.store, { actorId: user.id, action: locked ? "AUTH_LOCKOUT" : "AUTH_FAIL", entity: "user", entityId: user.id, detail: { failedAttempts: attempts }, ip });
      return { ok: false, reason: locked ? "LOCKED_OUT" : "INVALID_CREDENTIALS" };
    }

    // Only checked after the password is proven — an attacker guessing passwords learns nothing
    // about where (or whether) the real user is signed in.
    const { idleTimeoutMinutes, singleIp } = await this.securitySettings();
    const now = Date.now();
    const sessions = await this.store.sessions.listForUser(user.id);
    for (const s of sessions) if (!this.isLive(s, idleTimeoutMinutes, now)) await this.store.sessions.delete(s.token);
    if (singleIp && sessions.some((s) => this.isLive(s, idleTimeoutMinutes, now) && s.ip !== ip)) {
      await audit(this.store, { actorId: user.id, action: "AUTH_BLOCKED_IP", entity: "user", entityId: user.id, detail: { reason: "active session on another IP" }, ip });
      return { ok: false, reason: "ACTIVE_ON_ANOTHER_IP" };
    }

    if (user.failedAttempts > 0) await this.store.users.update(user.id, { failedAttempts: 0 });
    const token = randomBytes(32).toString("base64url");
    const at = new Date(now).toISOString();
    await this.store.sessions.create({ token, userId: user.id, ip, createdAt: at, expiresAt: new Date(now + SESSION_TTL_MS).toISOString(), lastActivityAt: at });
    await audit(this.store, { actorId: user.id, action: "AUTH_SUCCESS", entity: "user", entityId: user.id, ip });
    return { ok: true, token, userId: user.id, role: user.role };
  }

  async logout(token: string): Promise<void> {
    await this.store.sessions.delete(token);
  }

  /** Runs on every authenticated request. */
  async resolveSession(token: string, ip: string): Promise<{ userId: string; role: Role; name: string } | null> {
    const s = await this.store.sessions.get(token);
    if (!s) return null;
    const { idleTimeoutMinutes, singleIp } = await this.securitySettings();
    const now = Date.now();
    if (!this.isLive(s, idleTimeoutMinutes, now)) {
      await this.store.sessions.delete(token);
      return null;
    }
    // A token presented from a different IP than it was issued to is either a copied/stolen token
    // or the device changed networks — either way the session ends and the user signs in again
    // (which then succeeds, because this was their only live session).
    if (singleIp && s.ip !== ip) {
      await this.store.sessions.delete(token);
      await audit(this.store, { actorId: s.userId, action: "AUTH_IP_MISMATCH", entity: "session", detail: { sessionIp: s.ip }, ip });
      return null;
    }
    const user = await this.store.users.get(s.userId);
    if (!user || user.locked) {
      await this.store.sessions.delete(token);
      return null;
    }
    if (now - new Date(s.lastActivityAt).getTime() > TOUCH_THROTTLE_MS) await this.store.sessions.touch(token, new Date(now).toISOString());
    return { userId: user.id, role: user.role, name: user.name || user.username };
  }

  // -------------------------------------------------------------------------------------------
  // user management

  private async summary(u: UserRecord): Promise<UserSummary> {
    const { idleTimeoutMinutes } = await this.securitySettings();
    const now = Date.now();
    const sessions = (await this.store.sessions.listForUser(u.id)).filter((s) => this.isLive(s, idleTimeoutMinutes, now));
    return {
      id: u.id,
      username: u.username,
      name: u.name || u.username,
      role: u.role,
      locked: u.locked,
      activeSessions: sessions.map((s) => ({ ip: s.ip, lastActivityAt: s.lastActivityAt })),
      createdAt: u.createdAt,
    };
  }

  async getUser(id: string): Promise<UserSummary | null> {
    const u = await this.store.users.get(id);
    return u ? this.summary(u) : null;
  }

  async listUsers(): Promise<UserSummary[]> {
    return Promise.all((await this.store.users.list()).map((u) => this.summary(u)));
  }

  async createUser(input: { username: string; name: string; role: Role }, actorId: string | null, fixedPassword?: string): Promise<{ id: string; password: string }> {
    const username = input.username.trim();
    if (!/^[A-Za-z0-9._-]{2,40}$/.test(username)) throw badRequest("Username: 2–40 letters, digits, dot, dash or underscore.");
    if (await this.store.users.getByUsername(username)) throw conflict("USERNAME_TAKEN", `"${username}" is already taken.`);
    const password = fixedPassword ?? generatePassword();
    const now = new Date().toISOString();
    const id = randomUUID();
    await this.store.users.create({ id, username, name: input.name.trim(), passwordHash: hashPassword(password), role: input.role, failedAttempts: 0, locked: false, createdAt: now, updatedAt: now });
    await audit(this.store, { actorId, action: "WRITE", entity: "user", entityId: id, detail: { created: username, role: input.role } });
    return { id, password };
  }

  private async requireUser(id: string): Promise<UserRecord> {
    const u = await this.store.users.get(id);
    if (!u) throw notFound("User");
    return u;
  }

  private async adminCount(): Promise<number> {
    return (await this.store.users.list()).filter((u) => u.role === "admin" && !u.locked).length;
  }

  async updateUser(id: string, patch: { name?: string; role?: Role; locked?: boolean }, actorId: string): Promise<UserSummary> {
    const u = await this.requireUser(id);
    if (id === actorId && (patch.locked || (patch.role && patch.role !== u.role))) throw forbidden("You can't lock yourself or change your own role.");
    if (u.role === "admin" && ((patch.role && patch.role !== "admin") || patch.locked) && (await this.adminCount()) <= 1) {
      throw conflict("LAST_ADMIN", "This is the only active admin — create another admin first.");
    }
    await this.store.users.update(id, { name: patch.name?.trim(), role: patch.role, locked: patch.locked, failedAttempts: patch.locked === false ? 0 : undefined });
    if (patch.locked) await this.store.sessions.deleteForUser(id);
    await audit(this.store, { actorId, action: "WRITE", entity: "user", entityId: id, detail: patch });
    return (await this.getUser(id))!;
  }

  async resetPassword(id: string, actorId: string): Promise<{ password: string }> {
    await this.requireUser(id);
    const password = generatePassword();
    await this.store.users.update(id, { passwordHash: hashPassword(password), failedAttempts: 0, locked: false });
    await this.store.sessions.deleteForUser(id);
    await audit(this.store, { actorId, action: "WRITE", entity: "user", entityId: id, detail: { passwordReset: true } });
    return { password };
  }

  async changeOwnPassword(id: string, current: string, next: string): Promise<void> {
    const u = await this.requireUser(id);
    if (!verifyPassword(current, u.passwordHash)) throw new HttpError(400, "WRONG_PASSWORD", "Current password is incorrect.");
    if (next.length < 8) throw badRequest("New password must be at least 8 characters.");
    await this.store.users.update(id, { passwordHash: hashPassword(next) });
    await audit(this.store, { actorId: id, action: "WRITE", entity: "user", entityId: id, detail: { passwordChanged: true } });
  }

  async endSessions(id: string, actorId: string): Promise<void> {
    await this.requireUser(id);
    await this.store.sessions.deleteForUser(id);
    await audit(this.store, { actorId, action: "WRITE", entity: "user", entityId: id, detail: { sessionsEnded: true } });
  }

  async ensureBootstrapAdmin(username: string, fixedPassword?: string): Promise<{ username: string; password: string } | null> {
    if ((await this.store.users.count()) > 0) return null;
    const { password } = await this.createUser({ username, name: "Administrator", role: "admin" }, null, fixedPassword);
    return { username, password };
  }
}
