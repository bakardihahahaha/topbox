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
  username: string;
  name: string;
  role: "admin" | "operator";
  idleTimeoutMinutes: number;
}

const LOGIN_ERROR_LABEL: Record<string, string> = {
  INVALID_CREDENTIALS: "Incorrect username or password.",
  LOCKED_OUT: "Account locked after 3 failed attempts — ask an administrator for a new password.",
  ACTIVE_ON_ANOTHER_IP:
    "This account is already signed in from another network. Log out there first (or wait for it to time out), or ask an administrator to end that session.",
};

export async function login(username: string, password: string): Promise<{ ok: true } | { ok: false; error: string }> {
  let res: Response;
  try {
    res = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password }) });
  } catch {
    return { ok: false, error: "Can't reach the server — check your connection." };
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    if (res.status === 429) return { ok: false, error: "Too many sign-in attempts — wait a minute and try again." };
    return { ok: false, error: LOGIN_ERROR_LABEL[body.error ?? ""] ?? "Sign-in failed." };
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
