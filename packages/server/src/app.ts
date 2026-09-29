import { existsSync } from "node:fs";
import Fastify, { type FastifyInstance } from "fastify";
import fastifyStatic from "@fastify/static";
import rateLimit from "@fastify/rate-limit";
import { registerApi, type Services } from "./routes/api.js";
import { HttpError } from "./services/errors.js";
import { statusOf } from "./mirror/SheetsApi.js";
import { broadcastDataChange } from "./events.js";
import { audit, summarizeForAudit } from "./services/audit.js";

export const RATE_LIMITED_RETRY_AFTER_SECONDS = 30;

/** The one "temporarily busy, try again shortly" condition: Google answered 429 (quota), or the
 * NAS database was momentarily locked. Nothing else maps here — see the error handler below. */
export function isTransientBusy(err: unknown): boolean {
  if (statusOf(err) === 429 && !(err instanceof HttpError)) return true;
  const code = (err as { code?: string })?.code;
  return code === "SQLITE_BUSY" || code === "SQLITE_LOCKED";
}

export async function buildApp(services: Services, opts: { webDistPath?: string; logger?: boolean; trustProxy?: boolean } = {}): Promise<FastifyInstance> {
  const app = Fastify({
    // Behind DSM's reverse proxy every request arrives from the proxy — trusting X-Forwarded-For
    // is what makes req.ip the real client address, which single-IP sessions and the login rate
    // limit both depend on. Safe because the container's port is only published on 127.0.0.1.
    trustProxy: opts.trustProxy ?? false,
    logger: opts.logger
      ? { redact: { paths: ["req.url"], censor: (v) => (typeof v === "string" ? v.replace(/([?&]token=)[^&]+/i, "$1[REDACTED]") : v) } }
      : false,
    bodyLimit: 1024 * 1024,
  });

  await app.register(rateLimit, {
    global: true,
    max: 600,
    timeWindow: "1 minute",
    keyGenerator: (req) => {
      const h = req.headers.authorization;
      return h?.startsWith("Bearer ") ? h.slice(7) : req.ip;
    },
  });

  // Global error translator. Three outcomes, and the client's offline queue depends on them
  // staying distinct:
  //   503 + error "RATE_LIMITED" + retry-after -> transient; the client keeps the write queued and
  //                                               silently retries after retry-after seconds.
  //   HttpError (400/403/404/409)             -> a real rejection; shown to the user at once,
  //                                               never retried.
  //   anything else                           -> a bug; plain 500, never retried.
  // Google's raw error text never reaches the browser.
  app.setErrorHandler((err, req, reply) => {
    if (isTransientBusy(err)) {
      return reply.status(503).header("retry-after", String(RATE_LIMITED_RETRY_AFTER_SECONDS)).send({
        error: "RATE_LIMITED",
        message: "The server is busy for a moment — your change will be retried automatically.",
      });
    }
    if (err instanceof HttpError) return reply.status(err.status).send({ error: err.code, message: err.message });
    // @fastify/rate-limit's own 429 (too many requests from this IP/session) — deliberately NOT the
    // retry-silently RATE_LIMITED code: this is the caller being throttled, not the server being busy.
    if ((err as { statusCode?: number }).statusCode === 429) {
      return reply.status(429).send({ error: "TOO_MANY_REQUESTS", message: "Too many attempts — wait a minute and try again." });
    }
    const status = (err as { statusCode?: number }).statusCode;
    if (status && status >= 400 && status < 500) return reply.status(status).send({ error: (err as { code?: string }).code ?? "INVALID_REQUEST", message: (err as Error).message });
    req.log?.error(err);
    return reply.status(500).send({ error: "INTERNAL", message: "Something went wrong on the server." });
  });

  app.get("/health", async () => ({ ok: true }));
  registerApi(app, services);

  // Every successful write: tell every open screen to refetch, and record it in the audit log.
  const WRITE = new Set(["POST", "PUT", "PATCH", "DELETE"]);
  app.addHook("onResponse", async (req, reply) => {
    if (!WRITE.has(req.method) || !req.url.startsWith("/api/") || req.url.startsWith("/api/auth/")) return;
    if (reply.statusCode >= 200 && reply.statusCode < 300) broadcastDataChange();
    if (req.url.startsWith("/api/users")) return; // AuthService writes its own, more specific entries
    const path = req.url.split("?")[0]!;
    await audit(services.store, {
      actorId: req.user?.userId ?? null,
      action: req.method,
      entity: path.split("/")[2] ?? "unknown",
      entityId: path,
      detail: { status: reply.statusCode, body: summarizeForAudit(req.body) },
      ip: req.ip,
    }).catch(() => {});
  });

  if (opts.webDistPath && existsSync(opts.webDistPath)) {
    await app.register(fastifyStatic, { root: opts.webDistPath });
    app.setNotFoundHandler((req, reply) => {
      if (req.method !== "GET" || req.url.startsWith("/api/")) return reply.status(404).send({ error: "NOT_FOUND" });
      return reply.sendFile("index.html");
    });
  }

  return app;
}
