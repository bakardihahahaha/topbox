import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { DEFAULT_DOCUMENT_SETTINGS, type DocumentSettings, type Role } from "@biosite-signoff/shared";
import type { AuthService } from "../services/auth.js";
import type { CatalogService } from "../services/catalog.js";
import type { SignoffService } from "../services/signoffs.js";
import type { SignoffTypesService } from "../services/signoffTypes.js";
import type { MirrorService } from "../mirror/MirrorService.js";
import type { Store } from "../store/Store.js";
import { HttpError } from "../services/errors.js";
import { bearerToken, requireAdmin, requireAuth } from "./authMiddleware.js";
import { parse } from "./validate.js";
import { dataChangeEmitter } from "../events.js";

export interface Services {
  store: Store;
  auth: AuthService;
  catalog: CatalogService;
  signoffs: SignoffService;
  signoffTypes: SignoffTypesService;
  mirror: MirrorService;
}

const id = z.string().min(1).max(100);
const role = z.enum(["admin", "operator", "viewer", "parts"]);
const mode = z.enum(["new", "service"]);
const markValue = z.enum(["pass", "fail", "na"]);

const partInput = z.object({ partNumber: z.string().max(100), name: z.string().max(200), description: z.string().max(1000).default("") });

const templateInput = z.object({
  name: z.string().max(200),
  documentRef: z.string().max(300).default(""),
  documentId: z.string().max(100).default(""),
  serialLabel: z.string().max(100).default("Serial Number"),
  itemLabel: z.string().max(100).default("Item"),
  checks: z.array(z.object({ id, label: z.string().max(60) })).max(12),
  rows: z.array(z.object({ id, kind: z.enum(["item", "section"]), text: z.string().max(500), bold: z.boolean(), indent: z.boolean() })).max(200),
  signRowEnabled: z.boolean(),
  signRowLabel: z.string().max(100).default("Sign and date here"),
  distinctSigners: z.boolean().default(false),
  partIds: z.array(id).max(500).default([]),
});

// Login throttled per IP on top of the per-account 3-strike lockout and the cross-account IP guard
// (services/auth.ts lists every layer).
const LOGIN_RATE_LIMIT = { rateLimit: { max: 10, timeWindow: "1 minute" } };
const pin = z.string().regex(/^\d{4,8}$/, "PIN must be 4–8 digits");

export const DOCUMENT_SETTINGS_KEY = "document";

const documentSettingsInput = z.object({
  logoText: z.string().max(60),
  // Resized client-side to a small PNG/JPEG; the cap keeps it inside one Google Sheets cell.
  logoDataUrl: z.string().max(45_000).refine((v) => v === "" || /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(v), "Logo must be a PNG or JPEG image"),
  companyName: z.string().max(200),
  address: z.string().max(1000),
  footerText: z.string().max(500),
  documentIdLabel: z.string().max(100),
  showSignTime: z.boolean().default(true),
});

export async function readDocumentSettings(store: Store): Promise<DocumentSettings> {
  const raw = await store.appSettings.get(DOCUMENT_SETTINGS_KEY);
  const saved = raw ? (JSON.parse(raw) as Partial<DocumentSettings> & { logoTextAccent?: string }) : {};
  // Settings saved before the logo became one plain-text field kept it in two parts ("BIO" + "SITE").
  const { logoTextAccent, ...rest } = saved;
  const logoText = logoTextAccent !== undefined ? `${logoTextAccent}${rest.logoText ?? ""}` : rest.logoText;
  return { ...DEFAULT_DOCUMENT_SETTINGS, ...rest, ...(logoText !== undefined ? { logoText } : {}) };
}

export function registerApi(app: FastifyInstance, s: Services): void {
  const auth = requireAuth(s.auth);
  const authed = { preHandler: [auth] };
  const admin = { preHandler: [auth, requireAdmin()] };
  const actor = (req: { user?: { userId: string; role: Role; name: string } }) => req.user!;

  // ---- auth ----------------------------------------------------------------------------------

  /** Public — the sign-in screen's name tiles. Names only: no roles, no ids beyond what login needs. */
  app.get("/api/auth/users", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async () => s.auth.loginUsers());

  app.post("/api/auth/login", { config: LOGIN_RATE_LIMIT }, async (req, reply) => {
    const body = parse(z.object({ userId: id, pin: z.string().min(1).max(20) }), req.body);
    const result = await s.auth.login(body.userId, body.pin, req.ip);
    if (!result.ok) {
      const { ok: _ok, reason, ...rest } = result;
      return reply.status(reason === "IP_BLOCKED" ? 429 : 401).send({ error: reason, ...rest });
    }
    return { token: result.token, role: result.role, userId: result.userId };
  });

  app.post("/api/auth/logout", async (req) => {
    const token = bearerToken(req);
    if (token) await s.auth.logout(token);
    return { ok: true };
  });

  app.get("/api/auth/me", authed, async (req) => {
    const user = await s.auth.getUser(req.user!.userId);
    const sec = await s.auth.securitySettings();
    return { userId: user!.id, name: user!.name, role: user!.role, idleTimeoutMinutes: sec.idleTimeoutMinutes };
  });

  app.post("/api/auth/pin", authed, async (req) => {
    const body = parse(z.object({ current: z.string().min(1).max(20), next: pin }), req.body);
    await s.auth.changeOwnPin(req.user!.userId, body.current, body.next);
    return { ok: true };
  });

  app.get("/api/security", admin, async () => s.auth.securitySettings());
  app.patch("/api/security", admin, async (req) => {
    const body = parse(z.object({ idleTimeoutMinutes: z.number().int().optional(), singleIp: z.boolean().optional() }), req.body);
    return s.auth.setSecuritySettings(body, req.user!.userId);
  });

  // ---- users ---------------------------------------------------------------------------------

  app.get("/api/users", admin, async () => s.auth.listUsers());
  app.post("/api/users", admin, async (req) => {
    const body = parse(z.object({ name: z.string().max(60), role, pin: pin.optional() }), req.body);
    return s.auth.createUser(body, req.user!.userId);
  });
  app.patch<{ Params: { id: string } }>("/api/users/:id", admin, async (req) => {
    const body = parse(z.object({ name: z.string().max(100).optional(), role: role.optional(), locked: z.boolean().optional() }), req.body);
    return s.auth.updateUser(req.params.id, body, req.user!.userId);
  });
  app.post<{ Params: { id: string } }>("/api/users/:id/pin", admin, async (req) => {
    const body = parse(z.object({ pin: pin.optional() }), req.body ?? {});
    return s.auth.setPin(req.params.id, body.pin, req.user!.userId);
  });
  app.delete<{ Params: { id: string } }>("/api/users/:id", admin, async (req) => {
    await s.auth.deleteUser(req.params.id, req.user!.userId);
    return { ok: true };
  });
  app.post<{ Params: { id: string } }>("/api/users/:id/end-sessions", admin, async (req) => {
    await s.auth.endSessions(req.params.id, req.user!.userId);
    return { ok: true };
  });

  app.get("/api/audit", admin, async (req) => {
    const q = parse(z.object({ limit: z.coerce.number().int().min(1).max(1000).default(200) }), req.query);
    const users = new Map((await s.store.users.list()).map((u) => [u.id, u.name || u.username]));
    return (await s.store.audit.list(q.limit)).map((e) => ({ ...e, actorName: e.actorId ? (users.get(e.actorId) ?? e.actorId) : null }));
  });

  // ---- permissions ---------------------------------------------------------------------------

  app.get("/api/permissions", authed, async () => s.signoffs.permissions());
  app.get("/api/sign-policy", authed, async () => ({ operators: await s.signoffs.operatorCount() }));
  app.put("/api/permissions", admin, async (req) => s.signoffs.setPermissions(parse(z.object({ deleteSignoffs: z.enum(["admin", "all"]) }), req.body)));

  // ---- sign-off types (the New sign-off screen's buttons) -------------------------------------

  app.get("/api/signoff-types", authed, async () => s.signoffTypes.list());
  app.put("/api/signoff-types", admin, async (req) => {
    const body = parse(z.array(z.object({ id, name: z.string().max(40), description: z.string().max(80).default(""), allowsParts: z.boolean(), oncePerTopbox: z.boolean().optional(), refurbishedR: z.boolean().optional() })).max(12), req.body);
    return s.signoffTypes.save(body);
  });

  // ---- document settings (company header / address / footer / logo on every PDF) ------------

  app.get("/api/document-settings", authed, async () => readDocumentSettings(s.store));
  app.put("/api/document-settings", admin, async (req) => {
    const body = parse(documentSettingsInput, req.body);
    await s.store.appSettings.set(DOCUMENT_SETTINGS_KEY, JSON.stringify(body));
    return readDocumentSettings(s.store);
  });

  // ---- parts ---------------------------------------------------------------------------------

  app.get("/api/parts", authed, async () => s.catalog.listParts());
  app.post("/api/parts", admin, async (req) => {
    const body = parse(partInput.extend({ id: id.optional() }), req.body);
    return s.catalog.createPart(body, body.id);
  });
  app.patch<{ Params: { id: string } }>("/api/parts/:id", admin, async (req) => s.catalog.updatePart(req.params.id, parse(partInput.partial(), req.body)));
  app.delete<{ Params: { id: string } }>("/api/parts/:id", admin, async (req) => {
    await s.catalog.deletePart(req.params.id);
    return { ok: true };
  });

  // ---- templates -----------------------------------------------------------------------------

  app.get("/api/templates", authed, async () => s.catalog.listTemplates());
  app.get<{ Params: { id: string } }>("/api/templates/:id", authed, async (req) => s.catalog.getTemplate(req.params.id));
  app.post("/api/templates", admin, async (req) => {
    const body = parse(templateInput.extend({ id: id.optional() }), req.body);
    const { id: tid, ...input } = body;
    return s.catalog.createTemplate(input, tid);
  });
  app.put<{ Params: { id: string } }>("/api/templates/:id", admin, async (req) => s.catalog.updateTemplate(req.params.id, parse(templateInput, req.body)));
  app.post<{ Params: { id: string } }>("/api/templates/:id/duplicate", admin, async (req) => s.catalog.duplicateTemplate(req.params.id));
  app.delete<{ Params: { id: string } }>("/api/templates/:id", admin, async (req) => {
    await s.catalog.deleteTemplate(req.params.id);
    return { ok: true };
  });

  // ---- sign-offs -----------------------------------------------------------------------------

  app.get("/api/signoffs", authed, async (req) => {
    const q = parse(
      z.object({
        q: z.string().max(100).optional(),
        templateId: z.string().optional(),
        status: z.enum(["draft", "complete"]).optional(),
        mode: mode.optional(),
        typeId: z.string().optional(),
        limit: z.coerce.number().int().min(1).max(200).default(50),
        offset: z.coerce.number().int().min(0).default(0),
      }),
      req.query,
    );
    return s.signoffs.list({ search: q.q?.trim() || undefined, templateId: q.templateId || undefined, status: q.status, mode: q.mode, typeId: q.typeId || undefined, limit: q.limit, offset: q.offset });
  });

  /** Full records for several sign-offs at once — the multi-select "Generate PDF" on the list. */
  app.post("/api/signoffs/batch", authed, async (req) => {
    const body = parse(z.object({ ids: z.array(id).min(1).max(100) }), req.body);
    return Promise.all(body.ids.map((i) => s.signoffs.get(i)));
  });

  app.post("/api/signoffs", authed, async (req) => {
    const body = parse(z.object({ id: z.string().uuid(), templateId: id, serialNumber: z.string().max(100), typeId: id.optional(), mode: mode.optional(), arrivedAt: z.string().datetime().optional() }), req.body);
    return s.signoffs.create(body, actor(req));
  });

  app.get<{ Params: { id: string } }>("/api/signoffs/:id", authed, async (req) => s.signoffs.get(req.params.id));

  app.patch<{ Params: { id: string } }>("/api/signoffs/:id", authed, async (req) => {
    const body = parse(z.object({ serialNumber: z.string().max(100).optional(), notes: z.string().max(5000).optional(), typeId: id.optional(), mode: mode.optional(), arrivedAt: z.string().datetime().optional() }), req.body);
    return s.signoffs.updateHeader(req.params.id, body, actor(req));
  });

  app.delete<{ Params: { id: string } }>("/api/signoffs/:id", authed, async (req) => {
    await s.signoffs.remove(req.params.id, actor(req));
    return { ok: true };
  });

  app.put<{ Params: { id: string } }>("/api/signoffs/:id/marks", authed, async (req) => {
    const body = parse(z.object({ rowId: id, checkId: id, value: markValue.nullable() }), req.body);
    return s.signoffs.setMark(req.params.id, body, actor(req));
  });

  app.post<{ Params: { id: string } }>("/api/signoffs/:id/marks/fill", authed, async (req) => {
    const body = parse(z.object({ checkId: id, value: markValue }), req.body);
    return s.signoffs.fillCheck(req.params.id, body, actor(req));
  });

  app.post<{ Params: { id: string } }>("/api/signoffs/:id/marks/clear", authed, async (req) => {
    const body = parse(z.object({ checkId: id }), req.body);
    return s.signoffs.clearCheck(req.params.id, body.checkId, actor(req));
  });

  // ---- photos (taken during a check; JPEG files on the NAS) -----------------------------------

  // Resized on the device before upload (~0.2–1 MB); sent as a data URL so the offline queue can
  // hold it as plain JSON until there's signal.
  app.post<{ Params: { id: string } }>("/api/signoffs/:id/photos", { ...authed, bodyLimit: 15 * 1024 * 1024 }, async (req) => {
    const body = parse(
      z.object({
        photoId: z.string().uuid(),
        checkId: id,
        dataUrl: z.string().max(14 * 1024 * 1024).regex(/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/, "The photo must be a JPEG image"),
        takenAt: z.string().datetime().optional(),
        asUserId: id.optional(),
      }),
      req.body,
    );
    const jpeg = Buffer.from(body.dataUrl.slice(body.dataUrl.indexOf(",") + 1), "base64");
    return s.signoffs.addPhoto(req.params.id, { photoId: body.photoId, checkId: body.checkId, jpeg, takenAt: body.takenAt, asUserId: body.asUserId }, actor(req));
  });

  app.get<{ Params: { photoId: string } }>("/api/photos/:photoId", authed, async (req, reply) => {
    const jpeg = await s.signoffs.photoImage(req.params.photoId);
    // A photo never changes once taken — the device may keep it for good (also offline).
    return reply.type("image/jpeg").header("cache-control", "private, max-age=31536000, immutable").send(jpeg);
  });

  app.delete<{ Params: { id: string; photoId: string } }>("/api/signoffs/:id/photos/:photoId", authed, async (req) => s.signoffs.removePhoto(req.params.id, req.params.photoId, actor(req)));

  // ---- parts used (for booking parts out of stock in the stock system) ------------------------

  app.get("/api/parts-usage", authed, async (req) => {
    const q = parse(z.object({ from: z.string().datetime(), to: z.string().datetime() }), req.query);
    return s.signoffs.partsUsage(q.from, q.to);
  });
  app.post("/api/parts-usage/booked-out", authed, async (req) => {
    const body = parse(z.object({ lineIds: z.array(id).min(1).max(2000), booked: z.boolean() }), req.body);
    return { changed: await s.signoffs.setPartsBookedOut(body.lineIds, body.booked, actor(req)) };
  });

  // ---- mechanisms (one serial number across all its visits) ----------------------------------

  app.get("/api/mechanisms", authed, async (req) => {
    const q = parse(z.object({ q: z.string().max(100).optional(), limit: z.coerce.number().int().min(1).max(500).default(200) }), req.query);
    return s.signoffs.mechanisms(q.q?.trim() || undefined, q.limit);
  });
  app.get<{ Params: { typeId: string } }>("/api/stock/:typeId", authed, async (req) => s.signoffs.stock(req.params.typeId));
  app.get<{ Params: { typeId: string } }>("/api/types/:typeId/signoffs", authed, async (req) => s.signoffs.ofType(req.params.typeId));
  /** Every sign-off as a list row — the All sign-offs tab (it searches, filters and sorts itself). */
  app.get("/api/signoff-summaries", authed, async () => s.signoffs.ofType());
  app.get<{ Params: { serial: string } }>("/api/mechanisms/:serial/visits", authed, async (req) => s.signoffs.visits(req.params.serial));

  app.put<{ Params: { id: string; checkId: string } }>("/api/signoffs/:id/signatures/:checkId", authed, async (req) => {
    const body = parse(z.object({ path: z.string().max(40_000), date: z.string(), time: z.string().max(5).optional() }), req.body);
    return s.signoffs.sign(req.params.id, { checkId: req.params.checkId, ...body }, actor(req));
  });

  app.delete<{ Params: { id: string; checkId: string } }>("/api/signoffs/:id/signatures/:checkId", authed, async (req) => s.signoffs.unsign(req.params.id, req.params.checkId, actor(req)));

  app.put<{ Params: { id: string; lineId: string } }>("/api/signoffs/:id/parts/:lineId", authed, async (req) => {
    const body = parse(z.object({ partId: id, qty: z.number().int(), note: z.string().max(500).default("") }), req.body);
    return s.signoffs.setPart(req.params.id, req.params.lineId, body, actor(req));
  });

  app.delete<{ Params: { id: string; lineId: string } }>("/api/signoffs/:id/parts/:lineId", authed, async (req) => s.signoffs.removePart(req.params.id, req.params.lineId, actor(req)));

  // ---- backup mirror -------------------------------------------------------------------------

  app.get("/api/backup/status", admin, async () => s.mirror.status());

  app.put("/api/backup/config", admin, async (req) => {
    const body = parse(z.object({ spreadsheet: z.string().min(1).max(300) }), req.body);
    // Accepts either the bare id or the whole docs.google.com URL pasted from the address bar.
    const m = /\/spreadsheets\/d\/([A-Za-z0-9_-]+)/.exec(body.spreadsheet);
    const spreadsheetId = m ? m[1]! : body.spreadsheet.trim();
    if (!/^[A-Za-z0-9_-]{10,}$/.test(spreadsheetId)) throw new HttpError(400, "INVALID_REQUEST", "That doesn't look like a Google Sheets ID or URL.");
    if (await s.mirror.setSpreadsheetId(spreadsheetId)) await s.mirror.resyncAll();
    return s.mirror.status();
  });

  // These three call Google directly while the admin waits — a quota 429 surfaces through
  // main.ts's global translator as 503 RATE_LIMITED with retry-after, never as Google's raw text.
  app.post("/api/backup/sync-now", admin, async () => {
    const mirrored = await s.mirror.flush();
    return { mirrored, status: await s.mirror.status() };
  });

  app.post("/api/backup/resync-all", admin, async () => ({ queued: await s.mirror.resyncAll() }));

  app.get("/api/backup/inspect", admin, async () => s.mirror.inspect());

  app.post("/api/backup/restore", admin, async (req) => {
    const body = parse(z.object({ confirm: z.literal("RESTORE") }), req.body);
    void body;
    const hasData = (await s.store.tables.countRows("signoffs")) > 0;
    const force = (req.query as { force?: string }).force === "1";
    if (hasData && !force) {
      throw new HttpError(409, "NOT_EMPTY", "This database already has sign-offs. Restore is meant for a fresh NAS database — use force to merge anyway.");
    }
    return { restored: await s.mirror.restore() };
  });

  // ---- live events (SSE) ---------------------------------------------------------------------

  // EventSource can't send an Authorization header, so the token travels as ?token= here only
  // (redacted from logs in main.ts).
  app.get<{ Querystring: { token?: string } }>("/api/events", async (req, reply) => {
    const session = req.query.token ? await s.auth.resolveSession(req.query.token, req.ip) : null;
    if (!session) return reply.status(401).send({ error: "UNAUTHENTICATED" });
    reply.hijack();
    reply.raw.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive", "X-Accel-Buffering": "no" });
    reply.raw.write(": connected\n\n");
    const send = () => reply.raw.write("event: change\ndata: {}\n\n");
    const heartbeat = setInterval(() => reply.raw.write(": ping\n\n"), 20_000);
    dataChangeEmitter.on("change", send);
    req.raw.on("close", () => {
      clearInterval(heartbeat);
      dataChangeEmitter.off("change", send);
    });
  });
}
