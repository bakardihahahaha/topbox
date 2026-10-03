import type { Role } from "@biosite-signoff/shared";
import type { LoginUser } from "@biosite-signoff/shared";

const TOKEN_KEY = "biosite-signoff.token";

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

function setToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // best-effort
  }
}

/** `code` is the server's `error` field. offlineQueue.ts looks for exactly one combination —
 * status 503 + code "RATE_LIMITED" — to decide a write should wait and retry silently; every other
 * error is a real rejection shown to the user straight away. `retryAfterSeconds` carries the
 * server's retry-after header so the retry waits exactly as long as asked. */
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string | undefined,
    message: string,
    public retryAfterSeconds?: number,
  ) {
    super(message);
  }
}

/** Fired when any request comes back 401 — App.tsx drops to the sign-in screen (the session was
 * ended by idle timeout, an admin, or being used from another IP). */
/** "closed": the service is outside its operating hours (non-admins are signed out). */
type SignedOutReason = "session" | "closed" | "otherDevice";
const unauthorizedListeners = new Set<(reason: SignedOutReason) => void>();
export function onUnauthorized(listener: (reason: SignedOutReason) => void): () => void {
  unauthorizedListeners.add(listener);
  return () => unauthorizedListeners.delete(listener);
}

/** Signed out from elsewhere (the server said so over the live-events stream). */
export function signedOutHere(reason: SignedOutReason): void {
  setToken(null);
  try {
    localStorage.removeItem("biosite-signoff.me");
  } catch {
    // best-effort
  }
  unauthorizedListeners.forEach((l) => l(reason));
}

export async function authedFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const token = getToken();
  const res = await fetch(path, {
    ...init,
    headers: {
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
    if (res.status === 401 && path !== "/api/auth/login") {
      setToken(null);
      unauthorizedListeners.forEach((l) => l("session"));
    } else if (res.status === 503 && body.error === "SERVICE_CLOSED") {
      setToken(null);
      unauthorizedListeners.forEach((l) => l("closed"));
    }
    const retryAfter = Number(res.headers.get("retry-after"));
    throw new ApiError(res.status, body.error, body.message ?? body.error ?? `Request failed (${res.status}).`, Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined);
  }
  return res;
}

export async function getJson<T>(path: string): Promise<T> {
  return (await (await authedFetch(path)).json()) as T;
}

/** Like getJson, but remembers the answer on this device and returns that copy when there's no
 * connection (fetch threw) — reference data (checklists, parts) needed to keep working offline. */
export async function getJsonCached<T>(path: string): Promise<T> {
  const key = `biosite-signoff.cache:${path}`;
  try {
    const data = await getJson<T>(path);
    try {
      localStorage.setItem(key, JSON.stringify(data));
    } catch {
      // best-effort
    }
    return data;
  } catch (err) {
    const raw = err instanceof TypeError ? localStorage.getItem(key) : null;
    if (raw) return JSON.parse(raw) as T;
    throw err;
  }
}

export async function sendJson<T>(method: "POST" | "PUT" | "PATCH" | "DELETE", path: string, body?: unknown): Promise<T> {
  const res = await authedFetch(path, { method, body: body === undefined ? undefined : JSON.stringify(body) });
  return (await res.json()) as T;
}

export interface Me {
  userId: string;
  name: string;
  role: Role;
  /** May start new sign-offs and do the 1st check (Setup → Users); admins always. */
  canStart?: boolean;
  idleTimeoutMinutes: number;
}

export async function fetchLoginUsers(): Promise<LoginUser[]> {
  const res = await fetch("/api/auth/users");
  if (!res.ok) throw new Error(res.status === 429 ? "Too many requests — wait a minute." : `Couldn't load the user list (${res.status}).`);
  return (await res.json()) as LoginUser[];
}

export type LoginOutcome =
  | { ok: true }
  | { ok: false; code: string; error: string; attemptsLeft?: number; retryAt?: string };

const LOGIN_ERROR_LABEL: Record<string, string> = {
  INVALID_PIN: "Wrong PIN.",
  TEMP_LOCKED: "Too many wrong PINs — this account is locked for 5 minutes.",
  IP_BLOCKED: "Too many wrong PINs from this network — sign-in is paused for a while.",
  LOCKED_OUT: "This account is locked — ask an administrator to unlock it.",
  NO_SUCH_USER: "This user no longer exists.",
  TOO_MANY_REQUESTS: "Too many attempts — wait a minute and try again.",
  INVALID_LOGIN: "Wrong name or PIN.",
  SERVICE_CLOSED: "This service is closed.",
  ACTIVE_ON_ANOTHER_IP: "You're still signed in on another network. Log out there first (or wait for it to time out), or ask an administrator to end that session.",
};

export async function login(userId: string, pin: string): Promise<LoginOutcome> {
  let res: Response;
  try {
    res = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId, pin }) });
  } catch {
    return { ok: false, code: "OFFLINE", error: "Can't reach the server — check your connection." };
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string; attemptsLeft?: number; retryAt?: string };
    const code = body.error ?? "";
    return { ok: false, code, error: LOGIN_ERROR_LABEL[code] ?? "Sign-in failed.", attemptsLeft: body.attemptsLeft, retryAt: body.retryAt };
  }
  setToken(((await res.json()) as { token: string }).token);
  return { ok: true };
}

/** The hidden after-hours sign-in (#admin): name + PIN. */
export async function loginByName(name: string, pin: string): Promise<LoginOutcome> {
  let res: Response;
  try {
    res = await fetch("/api/auth/login-name", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, pin }) });
  } catch {
    return { ok: false, code: "OFFLINE", error: "Can't reach the server — check your connection." };
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string; retryAt?: string };
    const code = body.error ?? "";
    return { ok: false, code, error: LOGIN_ERROR_LABEL[code] ?? "Sign-in failed.", retryAt: body.retryAt };
  }
  setToken(((await res.json()) as { token: string }).token);
  return { ok: true };
}

/** Public: whether the service is open now (operating hours). Unknown (offline) counts as open. */
export async function fetchServiceOpen(): Promise<boolean> {
  try {
    const res = await fetch("/api/auth/status");
    return res.ok ? ((await res.json()) as { open: boolean }).open : true;
  } catch {
    return true;
  }
}

/** Ends the session on the server too — with single-IP sessions on, that's what frees the account
 * to be used from a different network straight away. */
const ME_KEY = "biosite-signoff.me";

export async function logout(): Promise<void> {
  const token = getToken();
  setToken(null);
  try {
    localStorage.removeItem(ME_KEY);
  } catch {
    // best-effort
  }
  if (token) await fetch("/api/auth/logout", { method: "POST", headers: { Authorization: `Bearer ${token}` } }).catch(() => {});
}

export async function fetchMe(): Promise<Me | null> {
  const token = getToken();
  if (!token) return null;
  // Only a definite "this session is gone" (401) signs the device out. No signal, a proxy error
  // while the NAS restarts (502/503) etc. keep the person signed in on the last known identity —
  // they keep working locally and everything syncs once the server answers again.
  const remembered = (): Me | null => {
    try {
      return JSON.parse(localStorage.getItem(ME_KEY) ?? "null") as Me | null;
    } catch {
      return null;
    }
  };
  try {
    const res = await fetch("/api/auth/me", { headers: { Authorization: `Bearer ${token}` } });
    const closed = res.status === 503 && ((await res.clone().json().catch(() => ({}))) as { error?: string }).error === "SERVICE_CLOSED";
    if (res.status === 401 || closed) {
      setToken(null);
      localStorage.removeItem(ME_KEY);
      return null;
    }
    if (!res.ok) return remembered();
    const me = (await res.json()) as Me;
    try {
      localStorage.setItem(ME_KEY, JSON.stringify(me));
    } catch {
      // best-effort
    }
    return me;
  } catch {
    return remembered();
  }
}
