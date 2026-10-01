import { randomBytes, randomInt, randomUUID } from "node:crypto";
import { PIN_PATTERN, type LoginUser, type Role } from "@biosite-signoff/shared";
import type { Store, UserRecord } from "../store/Store.js";
import { audit } from "./audit.js";
import { HttpError, badRequest, conflict, forbidden, notFound } from "./errors.js";
import { hashPassword as hashPin, verifyPassword as verifyPin } from "./password.js";
import { DEFAULT_OPERATING_HOURS, OPERATING_HOURS_SETTING, isOpenAt, validOperatingHours, type OperatingHours } from "./operatingHours.js";

// Sign-in is "tap your name, type your PIN". The name list is public (that's the point — nobody
// has time to type a username), so everything rests on the PIN plus the layers below:
//
//   1. 3 wrong PINs on an account -> that account is locked for 5 minutes.
//   2. 5 such lockouts in a row without a successful sign-in (15 wrong PINs) -> hard lock that only
//      an admin can lift. A bot patiently waiting out the 5 minutes gets ~15 guesses, not thousands.
//   3. Per-IP guard across ALL accounts: 10 wrong PINs from one IP within 15 minutes blocks that IP
//      for 15 minutes — stops a bot rotating through the name list to dodge rule 1.
//   4. Every wrong PIN is answered only after a fixed delay, and the login route is rate limited
//      per IP (routes/api.ts) — brute force is slow even before any lock kicks in.
//   5. One network (IP) per account, and a session only works from the IP it was created on.
//   6. Everything — including every blocked attempt, with its IP — lands in the audit log.

export const PIN_ATTEMPTS = 3;
export const TEMP_LOCK_MS = 5 * 60_000;
export const HARD_LOCK_AFTER_LOCKOUTS = 5;
const IP_MAX_FAILURES = 10;
const IP_WINDOW_MS = 15 * 60_000;
const IP_BLOCK_MS = 15 * 60_000;

const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const TOUCH_THROTTLE_MS = 60_000;
const DEFAULT_IDLE_MINUTES = 30;

export const IDLE_SETTING = "security.idle_timeout_minutes";
export const SINGLE_IP_SETTING = "security.single_ip";

export interface SecuritySettings {
  /** 0 = never. */
  idleTimeoutMinutes: number;
  /** One account = one IP at a time. */
  singleIp: boolean;
}

export interface UserSummary {
  id: string;
  name: string;
  role: Role;
  locked: boolean;
  lockedUntil: string | null;
  activeSessions: { ip: string; lastActivityAt: string }[];
  /** May start new sign-offs and do the 1st check. */
  canStart: boolean;
  createdAt: string;
}

export type LoginResult =
  | { ok: true; token: string; userId: string; role: Role }
  | { ok: false; reason: "INVALID_PIN"; attemptsLeft: number }
  | { ok: false; reason: "TEMP_LOCKED" | "IP_BLOCKED"; retryAt: string }
  | { ok: false; reason: "LOCKED_OUT" | "NO_SUCH_USER" | "ACTIVE_ON_ANOTHER_IP" | "INVALID_LOGIN" | "SERVICE_CLOSED" };

/** In-memory per-IP failure counter (single server process — a restart simply forgives). */
export class IpGuard {
  private failures = new Map<string, number[]>();
  private blocked = new Map<string, number>();

  blockedUntil(ip: string, now = Date.now()): number | null {
    const until = this.blocked.get(ip);
    if (until && until > now) return until;
    if (until) this.blocked.delete(ip);
    return null;
  }

  /** Returns the block end if this failure tipped the IP over the limit. */
  recordFailure(ip: string, now = Date.now()): number | null {
    const recent = (this.failures.get(ip) ?? []).filter((t) => now - t < IP_WINDOW_MS);
    recent.push(now);
    this.failures.set(ip, recent);
    if (recent.length >= IP_MAX_FAILURES) {
      this.failures.delete(ip);
      this.blocked.set(ip, now + IP_BLOCK_MS);
      return now + IP_BLOCK_MS;
    }
    return null;
  }

  recordSuccess(ip: string): void {
    this.failures.delete(ip);
  }
}

const slug = (name: string) =>
  name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ".")
    .replace(/^\.|\.$/g, "") || "user";

export class AuthService {
  readonly ipGuard = new IpGuard();

  constructor(
    private readonly store: Store,
    private readonly opts: { failureDelayMs?: number; now?: () => number } = {},
  ) {}

  private now(): number {
    return this.opts.now?.() ?? Date.now();
  }

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

  private isLive(s: { expiresAt: string; lastActivityAt: string }, idleMinutes: number, now: number): boolean {
    if (new Date(s.expiresAt).getTime() < now) return false;
    return !(idleMinutes > 0 && now - new Date(s.lastActivityAt).getTime() > idleMinutes * 60_000);
  }

  private tempLockedUntil(u: UserRecord, now: number): string | null {
    return u.lockedUntil && new Date(u.lockedUntil).getTime() > now ? u.lockedUntil : null;
  }

  // ---- operating hours ------------------------------------------------------------------------

  async operatingHours(): Promise<OperatingHours> {
    const raw = await this.store.settings.get(OPERATING_HOURS_SETTING);
    if (!raw) return DEFAULT_OPERATING_HOURS;
    try {
      return { ...DEFAULT_OPERATING_HOURS, ...(JSON.parse(raw) as Partial<OperatingHours>) };
    } catch {
      return DEFAULT_OPERATING_HOURS;
    }
  }

  async setOperatingHours(h: OperatingHours, actorId: string): Promise<OperatingHours> {
    const clean = { ...h, days: [...new Set(h.days)].sort() };
    const problem = validOperatingHours(clean);
    if (problem) throw badRequest(problem);
    await this.store.settings.set(OPERATING_HOURS_SETTING, JSON.stringify(clean));
    await audit(this.store, { actorId, action: "WRITE", entity: "security_settings", detail: { operatingHours: clean } });
    return clean;
  }

  /** Outside operating hours: closed to everyone but admins. */
  async isClosed(): Promise<boolean> {
    return !isOpenAt(await this.operatingHours(), new Date(this.now()));
  }

  /** The hidden after-hours sign-in (#admin): name + PIN, admins only while closed. Every failure
   * gives the same answer, so it tells a guesser nothing about which names exist or who is admin. */
  async loginByName(name: string, pin: string, ip: string): Promise<LoginResult> {
    const user = (await this.store.users.list()).find((u) => (u.name || u.username).toLowerCase() === name.trim().toLowerCase());
    if (!user || (user.role !== "admin" && (await this.isClosed()))) {
      if (this.ipGuard.blockedUntil(ip, this.now())) return { ok: false, reason: "IP_BLOCKED", retryAt: new Date(this.ipGuard.blockedUntil(ip, this.now())!).toISOString() };
      await this.fail(ip);
      await audit(this.store, { actorId: null, action: "AUTH_FAIL", entity: "user", detail: { reason: "name sign-in refused", name: name.slice(0, 60) }, ip });
      return { ok: false, reason: "INVALID_LOGIN" };
    }
    const result = await this.login(user.id, pin, ip);
    return !result.ok && (result.reason === "INVALID_PIN" || result.reason === "NO_SUCH_USER") ? { ok: false, reason: "INVALID_LOGIN" } : result;
  }

  /** The sign-in screen's tiles — every active account; hard-locked ones are left off. Closed
   * (operating hours): none at all. */
  async loginUsers(): Promise<LoginUser[]> {
    if (await this.isClosed()) return [];
    const now = this.now();
    return (await this.store.users.list())
      .filter((u) => !u.locked)
      .map((u) => ({ id: u.id, name: u.name || u.username, lockedUntil: this.tempLockedUntil(u, now) }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  private async fail(ip: string): Promise<void> {
    this.ipGuard.recordFailure(ip, this.now());
    if (this.opts.failureDelayMs) await new Promise((r) => setTimeout(r, this.opts.failureDelayMs));
  }

  async login(userId: string, pin: string, ip: string): Promise<LoginResult> {
    const now = this.now();
    const ipBlock = this.ipGuard.blockedUntil(ip, now);
    if (ipBlock) {
      await audit(this.store, { actorId: null, action: "AUTH_BLOCKED_IP", entity: "user", entityId: userId, detail: { reason: "too many wrong PINs from this IP" }, ip });
      return { ok: false, reason: "IP_BLOCKED", retryAt: new Date(ipBlock).toISOString() };
    }

    const user = await this.store.users.get(userId);
    if (!user) {
      await this.fail(ip);
      return { ok: false, reason: "NO_SUCH_USER" };
    }
    if (user.role !== "admin" && (await this.isClosed())) {
      await this.fail(ip);
      return { ok: false, reason: "SERVICE_CLOSED" };
    }
    // Hammering an already-locked account still counts against the IP — that's exactly what a
    // bot rotating through the name list looks like.
    if (user.locked) {
      await this.fail(ip);
      await audit(this.store, { actorId: user.id, action: "AUTH_FAIL", entity: "user", entityId: user.id, detail: { reason: "hard locked" }, ip });
      return { ok: false, reason: "LOCKED_OUT" };
    }
    const temp = this.tempLockedUntil(user, now);
    if (temp) {
      await this.fail(ip);
      await audit(this.store, { actorId: user.id, action: "AUTH_FAIL", entity: "user", entityId: user.id, detail: { reason: "temporarily locked" }, ip });
      return { ok: false, reason: "TEMP_LOCKED", retryAt: temp };
    }

    if (!verifyPin(pin, user.pinHash)) {
      const attempts = user.failedAttempts + 1;
      await this.fail(ip);
      if (attempts < PIN_ATTEMPTS) {
        await this.store.users.update(user.id, { failedAttempts: attempts });
        await audit(this.store, { actorId: user.id, action: "AUTH_FAIL", entity: "user", entityId: user.id, detail: { failedAttempts: attempts }, ip });
        return { ok: false, reason: "INVALID_PIN", attemptsLeft: PIN_ATTEMPTS - attempts };
      }
      const lockouts = user.lockouts + 1;
      if (lockouts >= HARD_LOCK_AFTER_LOCKOUTS) {
        await this.store.users.update(user.id, { failedAttempts: 0, lockouts, locked: true, lockedUntil: "" });
        await this.store.sessions.deleteForUser(user.id);
        await audit(this.store, { actorId: user.id, action: "AUTH_LOCKOUT", entity: "user", entityId: user.id, detail: { hardLock: true, lockouts }, ip });
        return { ok: false, reason: "LOCKED_OUT" };
      }
      const retryAt = new Date(now + TEMP_LOCK_MS).toISOString();
      await this.store.users.update(user.id, { failedAttempts: 0, lockouts, lockedUntil: retryAt });
      await audit(this.store, { actorId: user.id, action: "AUTH_LOCKOUT", entity: "user", entityId: user.id, detail: { minutes: TEMP_LOCK_MS / 60_000, lockouts }, ip });
      return { ok: false, reason: "TEMP_LOCKED", retryAt };
    }

    // Only checked once the PIN is proven — a guesser learns nothing about where the user is.
    const { idleTimeoutMinutes, singleIp } = await this.securitySettings();
    const sessions = await this.store.sessions.listForUser(user.id);
    for (const s of sessions) if (!this.isLive(s, idleTimeoutMinutes, now)) await this.store.sessions.delete(s.token);
    if (singleIp && sessions.some((s) => this.isLive(s, idleTimeoutMinutes, now) && s.ip !== ip)) {
      await audit(this.store, { actorId: user.id, action: "AUTH_BLOCKED_IP", entity: "user", entityId: user.id, detail: { reason: "active session on another IP" }, ip });
      return { ok: false, reason: "ACTIVE_ON_ANOTHER_IP" };
    }

    this.ipGuard.recordSuccess(ip);
    if (user.failedAttempts || user.lockouts || user.lockedUntil) await this.store.users.update(user.id, { failedAttempts: 0, lockouts: 0, lockedUntil: "" });
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
  async resolveSession(token: string, ip: string): Promise<{ userId: string; role: Role; name: string; canStart: boolean } | null> {
    const s = await this.store.sessions.get(token);
    if (!s) return null;
    const { idleTimeoutMinutes, singleIp } = await this.securitySettings();
    const now = this.now();
    if (!this.isLive(s, idleTimeoutMinutes, now)) {
      await this.store.sessions.delete(token);
      return null;
    }
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
    return { userId: user.id, role: user.role, name: user.name || user.username, canStart: user.role === "admin" || user.canStart !== false };
  }

  // -------------------------------------------------------------------------------------------
  // user management

  private async summary(u: UserRecord): Promise<UserSummary> {
    const { idleTimeoutMinutes } = await this.securitySettings();
    const now = this.now();
    const sessions = (await this.store.sessions.listForUser(u.id)).filter((s) => this.isLive(s, idleTimeoutMinutes, now));
    return {
      id: u.id,
      name: u.name || u.username,
      role: u.role,
      locked: u.locked,
      canStart: u.role === "admin" || u.canStart !== false,
      lockedUntil: this.tempLockedUntil(u, now),
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

  private assertPin(pin: string) {
    if (!PIN_PATTERN.test(pin)) throw badRequest("PIN must be 4–8 digits.");
  }

  private async assertUniqueName(name: string, exceptId?: string) {
    const clash = (await this.store.users.list()).find((u) => (u.name || u.username).toLowerCase() === name.toLowerCase() && u.id !== exceptId);
    if (clash) throw conflict("NAME_TAKEN", `There's already a user called "${name}" — names must be unique so the sign-in list is unambiguous.`);
  }

  /** `pin` omitted = a random 6-digit PIN, returned once. */
  async createUser(input: { name: string; role: Role; pin?: string; canStart?: boolean }, actorId: string | null): Promise<{ id: string; pin: string }> {
    const name = input.name.trim();
    if (!name || name.length > 60) throw badRequest("Name is required (max 60 characters).");
    await this.assertUniqueName(name);
    const pin = input.pin ?? String(randomInt(0, 1_000_000)).padStart(6, "0");
    this.assertPin(pin);
    // Internal, never shown: the login is by tapping the name.
    let username = slug(name);
    for (let i = 2; await this.store.users.getByUsername(username); i++) username = `${slug(name)}.${i}`;
    const now = new Date(this.now()).toISOString();
    const id = randomUUID();
    await this.store.users.create({ id, username, name, pinHash: hashPin(pin), role: input.role, failedAttempts: 0, lockouts: 0, lockedUntil: "", locked: false, canStart: input.canStart ?? true, createdAt: now, updatedAt: now });
    await audit(this.store, { actorId, action: "WRITE", entity: "user", entityId: id, detail: { created: name, role: input.role } });
    return { id, pin };
  }

  private async requireUser(id: string): Promise<UserRecord> {
    const u = await this.store.users.get(id);
    if (!u) throw notFound("User");
    return u;
  }

  private async activeAdmins(): Promise<number> {
    return (await this.store.users.list()).filter((u) => u.role === "admin" && !u.locked).length;
  }

  async updateUser(id: string, patch: { name?: string; role?: Role; locked?: boolean; canStart?: boolean }, actorId: string): Promise<UserSummary> {
    const u = await this.requireUser(id);
    if (id === actorId && (patch.locked || (patch.role && patch.role !== u.role))) throw forbidden("You can't lock yourself or change your own role.");
    if (u.role === "admin" && ((patch.role && patch.role !== "admin") || patch.locked) && (await this.activeAdmins()) <= 1) {
      throw conflict("LAST_ADMIN", "This is the only active admin — create another admin first.");
    }
    const name = patch.name?.trim();
    if (name !== undefined) {
      if (!name) throw badRequest("Name is required.");
      await this.assertUniqueName(name, id);
    }
    // Unlocking clears every lockout counter too — a clean slate.
    const unlock = patch.locked === false ? { failedAttempts: 0, lockouts: 0, lockedUntil: "" } : {};
    await this.store.users.update(id, { name, role: patch.role, locked: patch.locked, canStart: patch.canStart, ...unlock });
    if (patch.locked) await this.store.sessions.deleteForUser(id);
    await audit(this.store, { actorId, action: "WRITE", entity: "user", entityId: id, detail: patch });
    return (await this.getUser(id))!;
  }

  async deleteUser(id: string, actorId: string): Promise<void> {
    const u = await this.requireUser(id);
    if (id === actorId) throw forbidden("You can't delete yourself.");
    if (!u.locked) throw conflict("BLOCK_FIRST", "Block this person first — only blocked people can be deleted for good.");
    if (u.role === "admin" && !u.locked && (await this.activeAdmins()) <= 1) throw conflict("LAST_ADMIN", "This is the only active admin.");
    await this.store.sessions.deleteForUser(id);
    await this.store.users.softDelete(id, new Date(this.now()).toISOString());
    await audit(this.store, { actorId, action: "WRITE", entity: "user", entityId: id, detail: { deleted: u.name } });
  }

  /** Admin sets a user's PIN (also lifts any lockout). `pin` omitted = random 6 digits. */
  async setPin(id: string, pin: string | undefined, actorId: string): Promise<{ pin: string }> {
    await this.requireUser(id);
    const next = pin ?? String(randomInt(0, 1_000_000)).padStart(6, "0");
    this.assertPin(next);
    await this.store.users.update(id, { pinHash: hashPin(next), failedAttempts: 0, lockouts: 0, lockedUntil: "", locked: false });
    await this.store.sessions.deleteForUser(id);
    await audit(this.store, { actorId, action: "WRITE", entity: "user", entityId: id, detail: { pinReset: true } });
    return { pin: next };
  }

  async changeOwnPin(id: string, current: string, next: string): Promise<void> {
    const u = await this.requireUser(id);
    if (!verifyPin(current, u.pinHash)) throw new HttpError(400, "WRONG_PIN", "Current PIN is incorrect.");
    this.assertPin(next);
    await this.store.users.update(id, { pinHash: hashPin(next) });
    await audit(this.store, { actorId: id, action: "WRITE", entity: "user", entityId: id, detail: { pinChanged: true } });
  }

  async endSessions(id: string, actorId: string): Promise<void> {
    await this.requireUser(id);
    await this.store.sessions.deleteForUser(id);
    await audit(this.store, { actorId, action: "WRITE", entity: "user", entityId: id, detail: { sessionsEnded: true } });
  }

  /** Emergency recovery (ADMIN_RESET in docker-compose.yml): the admin called `name` gets `pin`,
   * is unlocked and made admin — created if missing. Needs access to the NAS, never the web. */
  async resetAdmin(name: string, pin: string): Promise<void> {
    const user = (await this.store.users.list()).find((u) => (u.name || u.username).toLowerCase() === name.toLowerCase());
    if (!user) {
      await this.createUser({ name, role: "admin", pin }, null);
      return;
    }
    await this.store.users.update(user.id, { role: "admin" });
    await this.setPin(user.id, pin, user.id);
    await audit(this.store, { actorId: null, action: "ADMIN_RESET", entity: "user", entityId: user.id, detail: { via: "docker-compose ADMIN_RESET" } });
  }

  async ensureBootstrapAdmin(name = "Administrator", fixedPin?: string): Promise<{ name: string; pin: string } | null> {
    if ((await this.store.users.count()) > 0) return null;
    const { pin } = await this.createUser({ name, role: "admin", pin: fixedPin }, null);
    return { name, pin };
  }
}
