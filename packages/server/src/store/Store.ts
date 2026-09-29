import type { Mark, MarkValue, Part, ReplacedPart, Role, Signature, Signoff, SignoffMode, SignoffStatus, Template } from "@biosite-signoff/shared";
import type { MirroredTable, Row } from "./schema.js";

// The ONLY thing the rest of the server knows about persistence. Services and routes depend on
// this interface, never on SQLite — swapping the NAS's SQLite file for Postgres/MySQL/anything
// else means writing one new class that implements Store (see sqlite/SqliteStore.ts for the
// reference implementation) and changing one line in main.ts. Nothing else moves.
//
// Every method is async even though better-sqlite3 itself is synchronous, precisely so a
// network-backed engine can drop in without changing a single caller.
//
// Contract every implementation must keep (test/store.test.ts is written against the interface,
// so pointing it at a new implementation checks all of this):
//   - Each method is atomic on its own.
//   - Every write to a mirrored table (schema.ts TABLES) also records (table, id) in the outbox,
//     in the SAME transaction — the backup mirror can then never miss a change, even if the
//     process dies right after the write.
//   - Nothing is physically deleted from a mirrored table: "delete" sets deleted_at.

export interface UserRecord {
  id: string;
  username: string;
  name: string;
  /** bcrypt hash of the user's PIN. */
  pinHash: string;
  role: Role;
  /** Wrong PINs since the last lockout/success. */
  failedAttempts: number;
  /** Temporary lockouts in a row without a successful sign-in (escalates to a hard lock). */
  lockouts: number;
  /** ISO time until which sign-in is refused ('' = not temporarily locked). */
  lockedUntil: string;
  /** Hard lock — only an admin can lift it. */
  locked: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SessionRecord {
  token: string;
  userId: string;
  /** The IP the session was created from — with single-IP sessions on, it is only valid from
   * here (see AuthService.resolveSession). */
  ip: string;
  createdAt: string;
  expiresAt: string;
  lastActivityAt: string;
}

export interface AuditEntry {
  id: string;
  actorId: string | null;
  action: string;
  entity: string;
  entityId: string | null;
  detail: unknown;
  ip: string | null;
  at: string;
}

export interface SignoffListFilter {
  search?: string;
  templateId?: string;
  status?: SignoffStatus;
  mode?: SignoffMode;
  typeId?: string;
  /** Exact serial number (case-insensitive) — one mechanism's visits. */
  serial?: string;
  /** Default: in-progress first, then completed; newest first within each. "arrived_asc" = a mechanism's history in order. */
  order?: "created_desc" | "arrived_asc";
  limit: number;
  offset: number;
}

export interface UsersRepo {
  count(): Promise<number>;
  list(): Promise<UserRecord[]>;
  get(id: string): Promise<UserRecord | null>;
  getByUsername(username: string): Promise<UserRecord | null>;
  create(user: UserRecord): Promise<void>;
  update(id: string, patch: Partial<Omit<UserRecord, "id" | "createdAt">>): Promise<void>;
  softDelete(id: string, at: string): Promise<void>;
}

/** Mirrored key/value settings (value = JSON) — see schema.ts app_settings. */
export interface AppSettingsRepo {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
}

export interface SessionsRepo {
  create(session: SessionRecord): Promise<void>;
  get(token: string): Promise<SessionRecord | null>;
  touch(token: string, at: string): Promise<void>;
  delete(token: string): Promise<void>;
  deleteForUser(userId: string): Promise<void>;
  listForUser(userId: string): Promise<SessionRecord[]>;
  deleteExpired(now: string): Promise<void>;
}

export interface AuditRepo {
  write(entry: AuditEntry): Promise<void>;
  list(limit: number): Promise<AuditEntry[]>;
}

/** Small key/value settings (security policy, backup spreadsheet id, running counters). */
export interface SettingsRepo {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
}

export interface PartsRepo {
  list(): Promise<Part[]>;
  get(id: string): Promise<Part | null>;
  create(part: Part): Promise<void>;
  update(id: string, patch: Partial<Omit<Part, "id" | "createdAt">>): Promise<void>;
  softDelete(id: string, at: string): Promise<void>;
}

export interface TemplatesRepo {
  list(): Promise<Template[]>;
  get(id: string): Promise<Template | null>;
  create(template: Template): Promise<void>;
  replace(template: Template): Promise<void>;
  softDelete(id: string, at: string): Promise<void>;
}

export interface SignoffsRepo {
  /** Idempotent on id — creating a sign-off whose id already exists is a no-op returning false,
   * so a retried create from the client's offline queue can never make a duplicate. */
  create(signoff: Omit<Signoff, "marks" | "signatures" | "parts"> & { status: SignoffStatus }): Promise<boolean>;
  get(id: string): Promise<(Signoff & { status: SignoffStatus }) | null>;
  list(filter: SignoffListFilter): Promise<{ items: (Signoff & { status: SignoffStatus })[]; total: number }>;
  /** Next free running number, e.g. 124 — the service formats it. */
  nextNumber(): Promise<number>;
  updateHeader(id: string, patch: { serialNumber?: string; notes?: string; mode?: SignoffMode; typeId?: string; typeName?: string; arrivedAt?: string }, at: string): Promise<void>;
  /** Serial numbers with their visit count and latest sign-off id, most recently active first. */
  serials(search: string | undefined, limit: number): Promise<{ serialNumber: string; visits: number; lastId: string }[]>;
  setStatus(id: string, status: SignoffStatus, at: string): Promise<void>;
  softDelete(id: string, at: string): Promise<void>;

  upsertMark(signoffId: string, mark: Mark): Promise<void>;
  clearMark(signoffId: string, rowId: string, checkId: string, at: string): Promise<void>;
  upsertMarks(signoffId: string, marks: Mark[]): Promise<void>;
  /** Clears every mark in one check column. */
  clearMarks(signoffId: string, checkId: string, at: string): Promise<void>;

  upsertSignature(signoffId: string, signature: Signature): Promise<void>;
  clearSignature(signoffId: string, checkId: string, at: string): Promise<void>;

  upsertPart(signoffId: string, part: ReplacedPart, at: string): Promise<void>;
  removePart(signoffId: string, partRowId: string, at: string): Promise<void>;
}

/** The backup mirror's durable to-do list: (table, row id) pairs changed since the last push. */
export interface OutboxRepo {
  pending(limit: number): Promise<{ table: MirroredTable; rowId: string }[]>;
  ack(entries: { table: MirroredTable; rowId: string }[]): Promise<void>;
  count(): Promise<number>;
  /** Queues every row of every mirrored table — "full resync" after pointing at a new sheet. */
  enqueueAll(): Promise<number>;
}

/** Engine-neutral, all-strings row access over schema.ts's TABLES — what the mirror pushes,
 * what restore imports, and what an export to another engine would read. */
export interface TableAccess {
  readRows(table: MirroredTable, ids?: string[]): Promise<Row[]>;
  /** Upsert by id. Does NOT enqueue to the outbox (these rows came FROM the mirror). */
  importRows(table: MirroredTable, rows: Row[]): Promise<number>;
  countRows(table: MirroredTable): Promise<number>;
}

export interface Store {
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
  close(): Promise<void>;
}

export type { MarkValue };
