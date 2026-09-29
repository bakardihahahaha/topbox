import type { FastifyReply, FastifyRequest } from "fastify";
import type { Role } from "@biosite-signoff/shared";
import type { AuthService } from "../services/auth.js";

declare module "fastify" {
  interface FastifyRequest {
    user?: { userId: string; role: Role; name: string };
  }
}

export function bearerToken(req: FastifyRequest): string | undefined {
  const header = req.headers.authorization;
  return header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : undefined;
}

export function requireAuth(auth: AuthService) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const token = bearerToken(req);
    const session = token ? await auth.resolveSession(token, req.ip) : null;
    if (!session) return reply.status(401).send({ error: "UNAUTHENTICATED", message: "Please sign in again." });
    req.user = session;
  };
}

export function requireAdmin() {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    if (req.user?.role !== "admin") return reply.status(403).send({ error: "FORBIDDEN", message: "Admins only." });
  };
}
