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
const unauthorizedListeners = new Set<() => void>();
export function onUnauthorized(listener: () => void): () => void {
  unauthorizedListeners.add(listener);
  return () => unauthorizedListeners.delete(listener);
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
      unauthorizedListeners.forEach((l) => l());
    }
    const retryAfter = Number(res.headers.get("retry-after"));
    throw new ApiError(res.status, body.error, body.message ?? body.error ?? `Request failed (${res.status}).`, Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined);
  }
  return res;
}

export async function getJson<T>(path: string): Promise<T> {
  return (await (await authedFetch(path)).json()) as T;
}

export async function sendJson<T>(method: "POST" | "PUT" | "PATCH" | "DELETE", path: string, body?: unknown): Promise<T> {
  const res = await authedFetch(path, { method, body: body === undefined ? undefined : JSON.stringify(body) });
  return (await res.json()) as T;
}

export interface Me {
  userId: string;
  name: string;
  role: "admin" | "operator";
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

/** Ends the session on the server too — with single-IP sessions on, that's what frees the account
 * to be used from a different network straight away. */
export async function logout(): Promise<void> {
  const token = getToken();
  setToken(null);
  if (token) await fetch("/api/auth/logout", { method: "POST", headers: { Authorization: `Bearer ${token}` } }).catch(() => {});
}

export async function fetchMe(): Promise<Me | null> {
  const token = getToken();
  if (!token) return null;
  try {
    const res = await fetch("/api/auth/me", { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) {
      setToken(null);
      return null;
    }
    return (await res.json()) as Me;
  } catch {
    return null;
  }
}
