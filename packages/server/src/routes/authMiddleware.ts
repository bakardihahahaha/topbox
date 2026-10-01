import type { FastifyReply, FastifyRequest } from "fastify";
import type { Role } from "@biosite-signoff/shared";
import type { AuthService } from "../services/auth.js";

declare module "fastify" {
  interface FastifyRequest {
    user?: { userId: string; role: Role; name: string; canStart?: boolean };
  }
}

export function bearerToken(req: FastifyRequest): string | undefined {
  const header = req.headers.authorization;
  return header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : undefined;
}

const VIEWER_POSTS = new Set(["/api/signoffs/batch", "/api/auth/logout", "/api/auth/pin"]);
/** Everything a "parts" account may call — the Parts used page and its own session. */
const PARTS_ROUTES = new Set(["/api/parts-usage", "/api/parts-usage/booked-out", "/api/auth/me", "/api/auth/logout", "/api/auth/pin"]);

export function requireAuth(auth: AuthService) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const token = bearerToken(req);
    const session = token ? await auth.resolveSession(token, req.ip) : null;
    if (!session) return reply.status(401).send({ error: "UNAUTHENTICATED", message: "Please sign in again." });
    // Outside operating hours only admins get anything; anyone else's session ends here.
    if (session.role !== "admin" && (await auth.isClosed())) {
      await auth.logout(token!);
      return reply.status(503).send({ error: "SERVICE_CLOSED", message: "This service is closed." });
    }
    req.user = session;
    // A viewer only looks: every write is refused here, in one place, whatever the route — except
    // the few POSTs that don't change anything (fetching sign-offs for a PDF, signing out, their
    // own PIN).
    if (session.role === "parts" && !PARTS_ROUTES.has(req.routeOptions.url ?? "")) {
      return reply.status(403).send({ error: "PARTS_ONLY", message: "This account can only use the Parts used page." });
    }
    if (session.role === "viewer" && req.method !== "GET" && req.method !== "HEAD" && !VIEWER_POSTS.has(req.routeOptions.url ?? "")) {
      return reply.status(403).send({ error: "VIEW_ONLY", message: "Viewers can look and download PDFs only." });
    }
  };
}

export function requireAdmin() {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    if (req.user?.role !== "admin") return reply.status(403).send({ error: "FORBIDDEN", message: "Admins only." });
  };
}
