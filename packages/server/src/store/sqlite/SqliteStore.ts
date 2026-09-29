import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { mechanismKey, type Mark, type Part, type ReplacedPart, type Signature, type Signoff, type SignoffPhoto, type SignoffStatus, type Template, type Role } from "@biosite-signoff/shared";
import type {
  AppSettingsRepo,
  AuditEntry,
  AuditRepo,
  OutboxRepo,
  PartsRepo,
  SessionRecord,
  SessionsRepo,
  SettingsRepo,
  SignoffListFilter,
  SignoffsRepo,
  Store,
  TableAccess,
  TemplatesRepo,
  UserRecord,
  UsersRepo,
} from "../Store.js";
import { TABLES, tableSpec, type MirroredTable, type Row } from "../schema.js";
import { migrate } from "./migrations.js";

/**
 * The reference Store implementation: one SQLite file on the NAS (WAL mode — fast local reads and
 * writes, no network hop, safe with the single server process this app runs as).
 */
export class SqliteStore implements Store {
  readonly db: Database.Database;
  users: UsersRepo;
  sessions: SessionsRepo;
  audit: AuditRepo;
  settings: SettingsRepo;
  appSettings: AppSettingsRepo;
  parts: PartsRepo;
  templates: TemplatesRepo;
  signoffs: SignoffsRepo;
  outbox: OutboxRepo;
  tables: TableAccess;

  constructor(path: string) {
    this.db = new Database(path);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("busy_timeout = 5000");
    this.db.pragma("foreign_keys = ON");
    migrate(this.db);

    const db = this.db;
    // Transactional outbox: called inside the same transaction as the write it records.
    const enqueue = (table: MirroredTable, rowId: string) =>
      db.prepare("INSERT INTO mirror_outbox (tbl, row_id, enqueued_at) VALUES (?, ?, ?) ON CONFLICT (tbl, row_id) DO UPDATE SET enqueued_at = excluded.enqueued_at").run(table, rowId, new Date().toISOString());
    const tx = <T>(fn: () => T): T => db.transaction(fn)();

    this.users = new SqliteUsers(db, enqueue, tx);
    this.sessions = new SqliteSessions(db);
    this.audit = new SqliteAudit(db);
    this.settings = new SqliteSettings(db);
    this.appSettings = new SqliteAppSettings(db, enqueue);
    this.parts = new SqliteParts(db, enqueue, tx);
    this.templates = new SqliteTemplates(db, enqueue, tx);
    this.signoffs = new SqliteSignoffs(db, enqueue, tx);
    this.outbox = new SqliteOutbox(db);
    this.tables = new SqliteTables(db);
  }

  async close(): Promise<void> {
    this.db.close();
  }
}

type Enqueue = (table: MirroredTable, rowId: string) => void;
type Tx = <T>(fn: () => T) => T;

// ---------------------------------------------------------------------------------------------
// users / sessions / audit / settings

interface UserRow {
  id: string;
  username: string;
  name: string;
  password_hash: string;
  role: Role;
  failed_attempts: number;
  lockouts: number;
  locked_until: string;
  locked: number;
  created_at: string;
  updated_at: string;
}

function toUser(r: UserRow): UserRecord {
  return {
    id: r.id,
    username: r.username,
    name: r.name,
    pinHash: r.password_hash,
    role: r.role,
    failedAttempts: r.failed_attempts,
    lockouts: r.lockouts,
    lockedUntil: r.locked_until,
    locked: Boolean(r.locked),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

class SqliteUsers implements UsersRepo {
  constructor(
    private db: Database.Database,
    private enqueue: Enqueue,
    private tx: Tx,
  ) {}

  async count() {
    return (this.db.prepare("SELECT COUNT(*) AS n FROM users WHERE deleted_at = ''").get() as { n: number }).n;
  }
  async list() {
    return (this.db.prepare("SELECT * FROM users WHERE deleted_at = '' ORDER BY username").all() as UserRow[]).map(toUser);
  }
  async get(id: string) {
    const r = this.db.prepare("SELECT * FROM users WHERE id = ? AND deleted_at = ''").get(id) as UserRow | undefined;
    return r ? toUser(r) : null;
  }
  async getByUsername(username: string) {
    const r = this.db.prepare("SELECT * FROM users WHERE username = ? COLLATE NOCASE AND deleted_at = ''").get(username) as UserRow | undefined;
    return r ? toUser(r) : null;
  }
  async create(u: UserRecord) {
    this.tx(() => {
      this.db
        .prepare("INSERT INTO users (id, username, name, password_hash, role, failed_attempts, lockouts, locked_until, locked, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .run(u.id, u.username, u.name, u.pinHash, u.role, u.failedAttempts, u.lockouts, u.lockedUntil, u.locked ? 1 : 0, u.createdAt, u.updatedAt);
      this.enqueue("users", u.id);
    });
  }
  async update(id: string, patch: Partial<Omit<UserRecord, "id" | "createdAt">>) {
    const cols: Record<string, unknown> = {};
    if (patch.username !== undefined) cols.username = patch.username;
    if (patch.name !== undefined) cols.name = patch.name;
    if (patch.pinHash !== undefined) cols.password_hash = patch.pinHash;
    if (patch.lockouts !== undefined) cols.lockouts = patch.lockouts;
    if (patch.lockedUntil !== undefined) cols.locked_until = patch.lockedUntil;
    if (patch.role !== undefined) cols.role = patch.role;
    if (patch.failedAttempts !== undefined) cols.failed_attempts = patch.failedAttempts;
    if (patch.locked !== undefined) cols.locked = patch.locked ? 1 : 0;
    cols.updated_at = patch.updatedAt ?? new Date().toISOString();
    const keys = Object.keys(cols);
    this.tx(() => {
      this.db.prepare(`UPDATE users SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE id = ?`).run(...keys.map((k) => cols[k]), id);
      this.enqueue("users", id);
    });
  }
  async softDelete(id: string, at: string) {
    this.tx(() => {
      // The username gets a suffix so the name can be reused for a new account later.
      this.db.prepare("UPDATE users SET deleted_at = ?, updated_at = ?, username = username || '#' || ? WHERE id = ?").run(at, at, id.slice(0, 8), id);
      this.enqueue("users", id);
    });
  }
}

class SqliteAppSettings implements AppSettingsRepo {
  constructor(
    private db: Database.Database,
    private enqueue: Enqueue,
  ) {}
  async get(key: string) {
    const r = this.db.prepare("SELECT value FROM app_settings WHERE id = ? AND deleted_at = ''").get(key) as { value: string } | undefined;
    return r?.value ?? null;
  }
  async set(key: string, value: string) {
    this.db.transaction(() => {
      this.db
        .prepare("INSERT INTO app_settings (id, value, updated_at) VALUES (?, ?, ?) ON CONFLICT (id) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, deleted_at = ''")
        .run(key, value, new Date().toISOString());
      this.enqueue("app_settings", key);
    })();
  }
}

interface SessionRow {
  token: string;
  user_id: string;
  ip: string;
  created_at: string;
  expires_at: string;
  last_activity_at: string;
}

const toSession = (r: SessionRow): SessionRecord => ({
  token: r.token,
  userId: r.user_id,
  ip: r.ip,
  createdAt: r.created_at,
  expiresAt: r.expires_at,
  lastActivityAt: r.last_activity_at,
});

class SqliteSessions implements SessionsRepo {
  constructor(private db: Database.Database) {}
  async create(s: SessionRecord) {
    this.db.prepare("INSERT INTO sessions (token, user_id, ip, created_at, expires_at, last_activity_at) VALUES (?, ?, ?, ?, ?, ?)").run(s.token, s.userId, s.ip, s.createdAt, s.expiresAt, s.lastActivityAt);
  }
  async get(token: string) {
    const r = this.db.prepare("SELECT * FROM sessions WHERE token = ?").get(token) as SessionRow | undefined;
    return r ? toSession(r) : null;
  }
  async touch(token: string, at: string) {
    this.db.prepare("UPDATE sessions SET last_activity_at = ? WHERE token = ?").run(at, token);
  }
  async delete(token: string) {
    this.db.prepare("DELETE FROM sessions WHERE token = ?").run(token);
  }
  async deleteForUser(userId: string) {
    this.db.prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);
  }
  async listForUser(userId: string) {
    return (this.db.prepare("SELECT * FROM sessions WHERE user_id = ?").all(userId) as SessionRow[]).map(toSession);
  }
  async deleteExpired(now: string) {
    this.db.prepare("DELETE FROM sessions WHERE expires_at < ?").run(now);
  }
}

class SqliteAudit implements AuditRepo {
  constructor(private db: Database.Database) {}
  async write(e: AuditEntry) {
    this.db
      .prepare("INSERT INTO audit_log (id, actor_id, action, entity, entity_id, detail_json, ip, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run(e.id, e.actorId, e.action, e.entity, e.entityId, e.detail === undefined ? null : JSON.stringify(e.detail), e.ip, e.at);
  }
  async list(limit: number) {
    const rows = this.db.prepare("SELECT * FROM audit_log ORDER BY at DESC LIMIT ?").all(limit) as {
      id: string;
      actor_id: string | null;
      action: string;
      entity: string;
      entity_id: string | null;
      detail_json: string | null;
      ip: string | null;
      at: string;
    }[];
    return rows.map((r) => ({
      id: r.id,
      actorId: r.actor_id,
      action: r.action,
      entity: r.entity,
      entityId: r.entity_id,
      detail: r.detail_json ? JSON.parse(r.detail_json) : null,
      ip: r.ip,
      at: r.at,
    }));
  }
}

class SqliteSettings implements SettingsRepo {
  constructor(private db: Database.Database) {}
  async get(key: string) {
    const r = this.db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined;
    return r?.value ?? null;
  }
  async set(key: string, value: string) {
    this.db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value").run(key, value);
  }
}

// ---------------------------------------------------------------------------------------------
// parts / templates

interface PartRow {
  id: string;
  part_number: string;
  name: string;
  description: string;
  created_at: string;
  updated_at: string;
}

const toPart = (r: PartRow): Part => ({ id: r.id, partNumber: r.part_number, name: r.name, description: r.description, createdAt: r.created_at, updatedAt: r.updated_at });

class SqliteParts implements PartsRepo {
  constructor(
    private db: Database.Database,
    private enqueue: Enqueue,
    private tx: Tx,
  ) {}
  async list() {
    return (this.db.prepare("SELECT * FROM parts WHERE deleted_at = '' ORDER BY part_number COLLATE NOCASE, name COLLATE NOCASE").all() as PartRow[]).map(toPart);
  }
  async get(id: string) {
    const r = this.db.prepare("SELECT * FROM parts WHERE id = ? AND deleted_at = ''").get(id) as PartRow | undefined;
    return r ? toPart(r) : null;
  }
  async create(p: Part) {
    this.tx(() => {
      this.db.prepare("INSERT INTO parts (id, part_number, name, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)").run(p.id, p.partNumber, p.name, p.description, p.createdAt, p.updatedAt);
      this.enqueue("parts", p.id);
    });
  }
  async update(id: string, patch: Partial<Omit<Part, "id" | "createdAt">>) {
    const cols: Record<string, unknown> = {};
    if (patch.partNumber !== undefined) cols.part_number = patch.partNumber;
    if (patch.name !== undefined) cols.name = patch.name;
    if (patch.description !== undefined) cols.description = patch.description;
    cols.updated_at = patch.updatedAt ?? new Date().toISOString();
    const keys = Object.keys(cols);
    this.tx(() => {
      this.db.prepare(`UPDATE parts SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE id = ?`).run(...keys.map((k) => cols[k]), id);
      this.enqueue("parts", id);
    });
  }
  async softDelete(id: string, at: string) {
    this.tx(() => {
      this.db.prepare("UPDATE parts SET deleted_at = ?, updated_at = ? WHERE id = ?").run(at, at, id);
      this.enqueue("parts", id);
    });
  }
}

interface TemplateRow {
  id: string;
  name: string;
  document_ref: string;
  document_id: string;
  serial_label: string;
  item_label: string;
  checks_json: string;
  rows_json: string;
  sign_row_enabled: string;
  sign_row_label: string;
  distinct_signers: string;
  part_ids_json: string;
  created_at: string;
  updated_at: string;
}

const toTemplate = (r: TemplateRow): Template => ({
  id: r.id,
  name: r.name,
  documentRef: r.document_ref,
  documentId: r.document_id,
  serialLabel: r.serial_label,
  itemLabel: r.item_label || "Item",
  checks: JSON.parse(r.checks_json),
  rows: JSON.parse(r.rows_json),
  signRowEnabled: r.sign_row_enabled === "1",
  signRowLabel: r.sign_row_label,
  distinctSigners: r.distinct_signers === "1",
  partIds: JSON.parse(r.part_ids_json),
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

class SqliteTemplates implements TemplatesRepo {
  constructor(
    private db: Database.Database,
    private enqueue: Enqueue,
    private tx: Tx,
  ) {}
  async list() {
    return (this.db.prepare("SELECT * FROM templates WHERE deleted_at = '' ORDER BY name COLLATE NOCASE").all() as TemplateRow[]).map(toTemplate);
  }
  async get(id: string) {
    const r = this.db.prepare("SELECT * FROM templates WHERE id = ? AND deleted_at = ''").get(id) as TemplateRow | undefined;
    return r ? toTemplate(r) : null;
  }
  private params(t: Template) {
    return [
      t.name,
      t.documentRef,
      t.documentId,
      t.serialLabel,
      t.itemLabel,
      JSON.stringify(t.checks),
      JSON.stringify(t.rows),
      t.signRowEnabled ? "1" : "0",
      t.signRowLabel,
      t.distinctSigners ? "1" : "0",
      JSON.stringify(t.partIds),
    ];
  }
  async create(t: Template) {
    this.tx(() => {
      this.db
        .prepare(
          `INSERT INTO templates (name, document_ref, document_id, serial_label, item_label, checks_json, rows_json, sign_row_enabled, sign_row_label, distinct_signers, part_ids_json, id, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(...this.params(t), t.id, t.createdAt, t.updatedAt);
      this.enqueue("templates", t.id);
    });
  }
  async replace(t: Template) {
    this.tx(() => {
      this.db
        .prepare(
          `UPDATE templates SET name = ?, document_ref = ?, document_id = ?, serial_label = ?, item_label = ?, checks_json = ?, rows_json = ?, sign_row_enabled = ?,
             sign_row_label = ?, distinct_signers = ?, part_ids_json = ?, updated_at = ? WHERE id = ?`,
        )
        .run(...this.params(t), t.updatedAt, t.id);
      this.enqueue("templates", t.id);
    });
  }
  async softDelete(id: string, at: string) {
    this.tx(() => {
      this.db.prepare("UPDATE templates SET deleted_at = ?, updated_at = ? WHERE id = ?").run(at, at, id);
      this.enqueue("templates", id);
    });
  }
}

// ---------------------------------------------------------------------------------------------
// signoffs

interface SignoffRow {
  id: string;
  number: string;
  template_id: string;
  template_json: string;
  serial_number: string;
  arrived_at: string;
  mode: "new" | "service";
  type_id: string;
  type_name: string;
  status: SignoffStatus;
  notes: string;
  created_by: string;
  created_by_name: string;
  created_at: string;
  updated_at: string;
}

interface MarkRow {
  signoff_id: string;
  row_id: string;
  check_id: string;
  value: Mark["value"];
  by_user_id: string;
  by_name: string;
  at: string;
}

interface SignatureRow {
  signoff_id: string;
  check_id: string;
  user_id: string;
  name: string;
  path: string;
  date: string;
  time: string;
  at: string;
}

interface PhotoRow {
  id: string;
  signoff_id: string;
  check_id: string;
  file: string;
  taken_by: string;
  taken_by_name: string;
  taken_at: string;
}

const toPhoto = (p: PhotoRow): SignoffPhoto => ({ id: p.id, checkId: p.check_id, takenBy: p.taken_by, takenByName: p.taken_by_name, takenAt: p.taken_at });

/** SQL twin of mechanismKey(): upper-cased, a trailing "R" after a digit dropped. */
const MECHANISM_KEY_SQL = "(CASE WHEN upper(serial_number) GLOB '*[0-9]R' THEN substr(upper(serial_number), 1, length(serial_number) - 1) ELSE upper(serial_number) END)";

interface PartLineRow {
  id: string;
  signoff_id: string;
  part_id: string;
  part_number: string;
  name: string;
  qty: string;
  note: string;
}

/** Deterministic child-row ids: one mark per (sign-off, row, check), one signature per
 * (sign-off, check) — so a retried upsert always lands on the same row, locally and in the mirror. */
const markId = (signoffId: string, rowId: string, checkId: string) => `${signoffId}:${rowId}:${checkId}`;
const signatureId = (signoffId: string, checkId: string) => `${signoffId}:${checkId}`;

class SqliteSignoffs implements SignoffsRepo {
  constructor(
    private db: Database.Database,
    private enqueue: Enqueue,
    private tx: Tx,
  ) {}

  private touch(id: string, at: string) {
    this.db.prepare("UPDATE signoffs SET updated_at = ? WHERE id = ?").run(at, id);
    this.enqueue("signoffs", id);
  }

  async create(s: Omit<Signoff, "marks" | "signatures" | "parts" | "photos"> & { status: SignoffStatus }) {
    return this.tx(() => {
      const res = this.db
        .prepare(
          `INSERT OR IGNORE INTO signoffs (id, number, template_id, template_json, serial_number, arrived_at, mode, type_id, type_name, status, notes, created_by, created_by_name, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(s.id, s.number, s.templateId, JSON.stringify(s.template), s.serialNumber, s.arrivedAt, s.mode, s.typeId, s.typeName, s.status, s.notes, s.createdBy, s.createdByName, s.createdAt, s.updatedAt);
      if (res.changes === 0) return false;
      this.enqueue("signoffs", s.id);
      return true;
    });
  }

  private hydrate(rows: SignoffRow[]): (Signoff & { status: SignoffStatus })[] {
    if (rows.length === 0) return [];
    const ids = rows.map((r) => r.id);
    const placeholders = ids.map(() => "?").join(",");
    const marks = this.db.prepare(`SELECT * FROM signoff_marks WHERE deleted_at = '' AND signoff_id IN (${placeholders})`).all(...ids) as MarkRow[];
    const sigs = this.db.prepare(`SELECT * FROM signoff_signatures WHERE deleted_at = '' AND signoff_id IN (${placeholders})`).all(...ids) as SignatureRow[];
    const parts = this.db.prepare(`SELECT * FROM signoff_parts WHERE deleted_at = '' AND signoff_id IN (${placeholders}) ORDER BY created_at`).all(...ids) as PartLineRow[];
    const photos = this.db.prepare(`SELECT * FROM signoff_photos WHERE deleted_at = '' AND signoff_id IN (${placeholders}) ORDER BY taken_at`).all(...ids) as PhotoRow[];
    return rows.map((r) => ({
      id: r.id,
      number: r.number,
      templateId: r.template_id,
      template: JSON.parse(r.template_json),
      serialNumber: r.serial_number,
      arrivedAt: r.arrived_at || r.created_at,
      mode: r.mode,
      typeId: r.type_id,
      typeName: r.type_name,
      status: r.status,
      notes: r.notes,
      createdBy: r.created_by,
      createdByName: r.created_by_name,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      marks: marks
        .filter((m) => m.signoff_id === r.id)
        .map((m) => ({ rowId: m.row_id, checkId: m.check_id, value: m.value, byUserId: m.by_user_id, byName: m.by_name, at: m.at })),
      signatures: sigs.filter((s) => s.signoff_id === r.id).map((s) => ({ checkId: s.check_id, userId: s.user_id, name: s.name, path: s.path, date: s.date, time: s.time, at: s.at })),
      parts: parts.filter((p) => p.signoff_id === r.id).map((p) => ({ id: p.id, partId: p.part_id, partNumber: p.part_number, name: p.name, qty: Number(p.qty) || 1, note: p.note })),
      photos: photos.filter((p) => p.signoff_id === r.id).map(toPhoto),
    }));
  }

  async get(id: string) {
    const r = this.db.prepare("SELECT * FROM signoffs WHERE id = ? AND deleted_at = ''").get(id) as SignoffRow | undefined;
    return r ? this.hydrate([r])[0]! : null;
  }

  async list(f: SignoffListFilter) {
    const where = ["deleted_at = ''"];
    const params: unknown[] = [];
    if (f.search) {
      where.push("(serial_number LIKE ? OR number LIKE ?)");
      params.push(`%${f.search}%`, `%${f.search}%`);
    }
    if (f.templateId) {
      where.push("template_id = ?");
      params.push(f.templateId);
    }
    if (f.status) {
      where.push("status = ?");
      params.push(f.status);
    }
    if (f.mode) {
      where.push("mode = ?");
      params.push(f.mode);
    }
    if (f.typeId) {
      where.push("type_id = ?");
      params.push(f.typeId);
    }
    if (f.serial) {
      where.push(`${MECHANISM_KEY_SQL} = ?`);
      params.push(mechanismKey(f.serial));
    }
    const clause = where.join(" AND ");
    const total = (this.db.prepare(`SELECT COUNT(*) AS n FROM signoffs WHERE ${clause}`).get(...params) as { n: number }).n;
    const rows = this.db.prepare(`SELECT * FROM signoffs WHERE ${clause} ORDER BY ${f.order === "arrived_asc" ? "arrived_at ASC, created_at ASC" : "CASE WHEN status = 'complete' THEN 1 ELSE 0 END, created_at DESC"} LIMIT ? OFFSET ?`).all(...params, f.limit, f.offset) as SignoffRow[];
    return { items: this.hydrate(rows), total };
  }

  async nextNumber() {
    const r = this.db.prepare("SELECT MAX(CAST(substr(number, 4) AS INTEGER)) AS n FROM signoffs").get() as { n: number | null };
    return (r.n ?? 0) + 1;
  }

  async updateHeader(id: string, patch: { serialNumber?: string; notes?: string; mode?: "new" | "service"; typeId?: string; typeName?: string; arrivedAt?: string }, at: string) {
    const cols: Record<string, unknown> = {};
    if (patch.serialNumber !== undefined) cols.serial_number = patch.serialNumber;
    if (patch.notes !== undefined) cols.notes = patch.notes;
    if (patch.mode !== undefined) cols.mode = patch.mode;
    if (patch.typeId !== undefined) cols.type_id = patch.typeId;
    if (patch.typeName !== undefined) cols.type_name = patch.typeName;
    if (patch.arrivedAt !== undefined) cols.arrived_at = patch.arrivedAt;
    const keys = Object.keys(cols);
    if (keys.length === 0) return;
    this.tx(() => {
      this.db.prepare(`UPDATE signoffs SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE id = ?`).run(...keys.map((k) => cols[k]), id);
      this.touch(id, at);
    });
  }

  async setStatus(id: string, status: SignoffStatus, at: string) {
    this.tx(() => {
      this.db.prepare("UPDATE signoffs SET status = ? WHERE id = ?").run(status, id);
      this.touch(id, at);
    });
  }

  async softDelete(id: string, at: string) {
    this.tx(() => {
      this.db.prepare("UPDATE signoffs SET deleted_at = ? WHERE id = ?").run(at, id);
      this.touch(id, at);
    });
  }

  private writeMark(signoffId: string, m: Mark) {
    const id = markId(signoffId, m.rowId, m.checkId);
    this.db
      .prepare(
        `INSERT INTO signoff_marks (id, signoff_id, row_id, check_id, value, by_user_id, by_name, at, updated_at, deleted_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '')
         ON CONFLICT (id) DO UPDATE SET value = excluded.value, by_user_id = excluded.by_user_id, by_name = excluded.by_name,
           at = excluded.at, updated_at = excluded.updated_at, deleted_at = ''`,
      )
      .run(id, signoffId, m.rowId, m.checkId, m.value, m.byUserId, m.byName, m.at, m.at);
    this.enqueue("signoff_marks", id);
  }

  async upsertMark(signoffId: string, m: Mark) {
    this.tx(() => {
      this.writeMark(signoffId, m);
      this.touch(signoffId, m.at);
    });
  }

  async upsertMarks(signoffId: string, marks: Mark[]) {
    if (marks.length === 0) return;
    this.tx(() => {
      for (const m of marks) this.writeMark(signoffId, m);
      this.touch(signoffId, marks[0]!.at);
    });
  }

  async clearMarks(signoffId: string, checkId: string, at: string) {
    this.tx(() => {
      const ids = this.db.prepare("SELECT id FROM signoff_marks WHERE signoff_id = ? AND check_id = ? AND deleted_at = ''").all(signoffId, checkId) as { id: string }[];
      const del = this.db.prepare("UPDATE signoff_marks SET deleted_at = ?, updated_at = ? WHERE id = ?");
      for (const { id } of ids) {
        del.run(at, at, id);
        this.enqueue("signoff_marks", id);
      }
      this.touch(signoffId, at);
    });
  }

  async serials(search: string | undefined, limit: number) {
    const where = search ? "AND serial_number LIKE ?" : "";
    const rows = this.db
      .prepare(
        `SELECT serial_number AS serialNumber, COUNT(*) AS visits, MAX(arrived_at || '|' || created_at || '|' || id) AS lastKey
         FROM signoffs WHERE deleted_at = '' ${where}
         GROUP BY ${MECHANISM_KEY_SQL} ORDER BY MAX(updated_at) DESC LIMIT ?`,
      )
      .all(...(search ? [`%${search}%`, limit] : [limit])) as { serialNumber: string; visits: number; lastKey: string }[];
    return rows.map((r) => ({ serialNumber: r.serialNumber, visits: r.visits, lastId: r.lastKey.split("|").pop()! }));
  }

  async clearMark(signoffId: string, rowId: string, checkId: string, at: string) {
    const id = markId(signoffId, rowId, checkId);
    this.tx(() => {
      const res = this.db.prepare("UPDATE signoff_marks SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at = ''").run(at, at, id);
      if (res.changes > 0) this.enqueue("signoff_marks", id);
      this.touch(signoffId, at);
    });
  }

  async upsertSignature(signoffId: string, s: Signature) {
    const id = signatureId(signoffId, s.checkId);
    this.tx(() => {
      this.db
        .prepare(
          `INSERT INTO signoff_signatures (id, signoff_id, check_id, user_id, name, path, date, time, at, updated_at, deleted_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '')
           ON CONFLICT (id) DO UPDATE SET user_id = excluded.user_id, name = excluded.name, path = excluded.path, date = excluded.date, time = excluded.time,
             at = excluded.at, updated_at = excluded.updated_at, deleted_at = ''`,
        )
        .run(id, signoffId, s.checkId, s.userId, s.name, s.path, s.date, s.time, s.at, s.at);
      this.enqueue("signoff_signatures", id);
      this.touch(signoffId, s.at);
    });
  }

  async clearSignature(signoffId: string, checkId: string, at: string) {
    const id = signatureId(signoffId, checkId);
    this.tx(() => {
      const res = this.db.prepare("UPDATE signoff_signatures SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at = ''").run(at, at, id);
      if (res.changes > 0) this.enqueue("signoff_signatures", id);
      this.touch(signoffId, at);
    });
  }

  async upsertPart(signoffId: string, p: ReplacedPart, at: string) {
    this.tx(() => {
      this.db
        .prepare(
          `INSERT INTO signoff_parts (id, signoff_id, part_id, part_number, name, qty, note, created_at, updated_at, deleted_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '')
           ON CONFLICT (id) DO UPDATE SET qty = excluded.qty, note = excluded.note, updated_at = excluded.updated_at, deleted_at = ''`,
        )
        .run(p.id, signoffId, p.partId, p.partNumber, p.name, String(p.qty), p.note, at, at);
      this.enqueue("signoff_parts", p.id);
      this.touch(signoffId, at);
    });
  }

  async addPhoto(signoffId: string, p: SignoffPhoto & { file: string }, at: string) {
    this.tx(() => {
      const res = this.db
        .prepare(
          `INSERT OR IGNORE INTO signoff_photos (id, signoff_id, check_id, file, taken_by, taken_by_name, taken_at, created_at, updated_at, deleted_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '')`,
        )
        .run(p.id, signoffId, p.checkId, p.file, p.takenBy, p.takenByName, p.takenAt, at, at);
      if (res.changes === 0) return;
      this.enqueue("signoff_photos", p.id);
      this.touch(signoffId, at);
    });
  }

  async getPhoto(photoId: string) {
    const r = this.db.prepare("SELECT * FROM signoff_photos WHERE id = ? AND deleted_at = ''").get(photoId) as PhotoRow | undefined;
    return r ? { ...toPhoto(r), signoffId: r.signoff_id, file: r.file } : null;
  }

  async removePhoto(signoffId: string, photoId: string, at: string) {
    this.tx(() => {
      const res = this.db.prepare("UPDATE signoff_photos SET deleted_at = ?, updated_at = ? WHERE id = ? AND signoff_id = ? AND deleted_at = ''").run(at, at, photoId, signoffId);
      if (res.changes > 0) this.enqueue("signoff_photos", photoId);
      this.touch(signoffId, at);
    });
  }

  async removePart(signoffId: string, partRowId: string, at: string) {
    this.tx(() => {
      const res = this.db.prepare("UPDATE signoff_parts SET deleted_at = ?, updated_at = ? WHERE id = ? AND signoff_id = ? AND deleted_at = ''").run(at, at, partRowId, signoffId);
      if (res.changes > 0) this.enqueue("signoff_parts", partRowId);
      this.touch(signoffId, at);
    });
  }
}

// ---------------------------------------------------------------------------------------------
// outbox + generic tables

class SqliteOutbox implements OutboxRepo {
  constructor(private db: Database.Database) {}
  async pending(limit: number) {
    const rows = this.db.prepare("SELECT tbl, row_id FROM mirror_outbox ORDER BY enqueued_at LIMIT ?").all(limit) as { tbl: MirroredTable; row_id: string }[];
    return rows.map((r) => ({ table: r.tbl, rowId: r.row_id }));
  }
  async ack(entries: { table: MirroredTable; rowId: string }[]) {
    const del = this.db.prepare("DELETE FROM mirror_outbox WHERE tbl = ? AND row_id = ?");
    this.db.transaction(() => {
      for (const e of entries) del.run(e.table, e.rowId);
    })();
  }
  async count() {
    return (this.db.prepare("SELECT COUNT(*) AS n FROM mirror_outbox").get() as { n: number }).n;
  }
  async enqueueAll() {
    const now = new Date().toISOString();
    let n = 0;
    this.db.transaction(() => {
      for (const t of TABLES) {
        n += this.db.prepare(`INSERT OR REPLACE INTO mirror_outbox (tbl, row_id, enqueued_at) SELECT ?, id, ? FROM ${t.name}`).run(t.name, now).changes;
      }
    })();
    return n;
  }
}

class SqliteTables implements TableAccess {
  constructor(private db: Database.Database) {}

  async readRows(table: MirroredTable, ids?: string[]) {
    const spec = tableSpec(table);
    const cols = spec.columns.join(", ");
    let rows: Record<string, unknown>[];
    if (ids) {
      if (ids.length === 0) return [];
      rows = [];
      // Chunked to stay well under SQLite's bound-parameter limit.
      for (let i = 0; i < ids.length; i += 500) {
        const chunk = ids.slice(i, i + 500);
        rows.push(...(this.db.prepare(`SELECT ${cols} FROM ${table} WHERE id IN (${chunk.map(() => "?").join(",")})`).all(...chunk) as Record<string, unknown>[]));
      }
    } else {
      rows = this.db.prepare(`SELECT ${cols} FROM ${table}`).all() as Record<string, unknown>[];
    }
    return rows.map((r) => Object.fromEntries(spec.columns.map((c) => [c, r[c] == null ? "" : String(r[c])])) as Row);
  }

  async importRows(table: MirroredTable, rows: Row[]) {
    const spec = tableSpec(table);
    // users carry local-only columns the mirror deliberately never has: a restored account gets
    // an unusable PIN hash and stays locked until an admin sets a new PIN.
    const extra = table === "users" ? ["password_hash", "failed_attempts"] : [];
    const cols = [...spec.columns, ...extra];
    const stmt = this.db.prepare(
      `INSERT INTO ${table} (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})
       ON CONFLICT (id) DO UPDATE SET ${spec.columns
         .filter((c) => c !== "id")
         .map((c) => `${c} = excluded.${c}`)
         .join(", ")}`,
    );
    let n = 0;
    this.db.transaction(() => {
      for (const row of rows) {
        if (!row.id) continue;
        if (table === "users") {
          const clash = this.db.prepare("SELECT id FROM users WHERE username = ? COLLATE NOCASE AND id != ?").get(row.username, row.id);
          if (clash) continue; // never overwrite a live account (e.g. the bootstrap admin) with a restored one
        }
        const values: (string | number)[] = spec.columns.map((c) => {
          const v = row[c] ?? "";
          if (table === "users" && c === "locked") return 1;
          return v;
        });
        if (table === "users") values.push("!restored-needs-reset", 0);
        stmt.run(...values);
        n++;
      }
    })();
    return n;
  }

  async countRows(table: MirroredTable) {
    tableSpec(table);
    return (this.db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE deleted_at = ''`).get() as { n: number }).n;
  }
}

export const newId = () => randomUUID();
