import type Database from "better-sqlite3";

// Numbered, append-only migrations tracked in PRAGMA user_version — add a new entry at the end,
// never edit one that has shipped. Column names of mirrored tables must match store/schema.ts.
const MIGRATIONS: string[] = [
  `
  CREATE TABLE users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL DEFAULT '',
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('admin', 'operator')),
    failed_attempts INTEGER NOT NULL DEFAULT 0,
    locked INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT NOT NULL DEFAULT ''
  );

  CREATE TABLE sessions (
    token TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    ip TEXT NOT NULL,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    last_activity_at TEXT NOT NULL
  );
  CREATE INDEX sessions_user ON sessions(user_id);

  CREATE TABLE audit_log (
    id TEXT PRIMARY KEY,
    actor_id TEXT,
    action TEXT NOT NULL,
    entity TEXT NOT NULL,
    entity_id TEXT,
    detail_json TEXT,
    ip TEXT,
    at TEXT NOT NULL
  );
  CREATE INDEX audit_at ON audit_log(at);

  CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE parts (
    id TEXT PRIMARY KEY,
    part_number TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT NOT NULL DEFAULT ''
  );

  CREATE TABLE templates (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    document_ref TEXT NOT NULL DEFAULT '',
    document_id TEXT NOT NULL DEFAULT '',
    serial_label TEXT NOT NULL DEFAULT 'Serial Number',
    checks_json TEXT NOT NULL,
    rows_json TEXT NOT NULL,
    sign_row_enabled TEXT NOT NULL DEFAULT '1',
    sign_row_label TEXT NOT NULL DEFAULT 'Sign and date here',
    distinct_signers TEXT NOT NULL DEFAULT '0',
    part_ids_json TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT NOT NULL DEFAULT ''
  );

  CREATE TABLE signoffs (
    id TEXT PRIMARY KEY,
    number TEXT NOT NULL UNIQUE,
    template_id TEXT NOT NULL,
    template_json TEXT NOT NULL,
    serial_number TEXT NOT NULL,
    mode TEXT NOT NULL CHECK (mode IN ('new', 'service')),
    status TEXT NOT NULL DEFAULT 'draft',
    notes TEXT NOT NULL DEFAULT '',
    created_by TEXT NOT NULL,
    created_by_name TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT NOT NULL DEFAULT ''
  );
  CREATE INDEX signoffs_serial ON signoffs(serial_number);
  CREATE INDEX signoffs_created ON signoffs(created_at);

  CREATE TABLE signoff_marks (
    id TEXT PRIMARY KEY,
    signoff_id TEXT NOT NULL,
    row_id TEXT NOT NULL,
    check_id TEXT NOT NULL,
    value TEXT NOT NULL,
    by_user_id TEXT NOT NULL,
    by_name TEXT NOT NULL,
    at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT NOT NULL DEFAULT '',
    UNIQUE (signoff_id, row_id, check_id)
  );

  CREATE TABLE signoff_signatures (
    id TEXT PRIMARY KEY,
    signoff_id TEXT NOT NULL,
    check_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    path TEXT NOT NULL,
    date TEXT NOT NULL,
    at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT NOT NULL DEFAULT '',
    UNIQUE (signoff_id, check_id)
  );

  CREATE TABLE signoff_parts (
    id TEXT PRIMARY KEY,
    signoff_id TEXT NOT NULL,
    part_id TEXT NOT NULL,
    part_number TEXT NOT NULL,
    name TEXT NOT NULL,
    qty TEXT NOT NULL DEFAULT '1',
    note TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT NOT NULL DEFAULT ''
  );
  CREATE INDEX signoff_parts_signoff ON signoff_parts(signoff_id);

  CREATE TABLE mirror_outbox (
    tbl TEXT NOT NULL,
    row_id TEXT NOT NULL,
    enqueued_at TEXT NOT NULL,
    PRIMARY KEY (tbl, row_id)
  );
  `,
  // 2: PIN sign-in with temporary lockouts, per-template item column label, mirrored app settings
  //    (document header/footer/logo). password_hash now holds the bcrypt hash of the PIN.
  `
  ALTER TABLE users ADD COLUMN locked_until TEXT NOT NULL DEFAULT '';
  ALTER TABLE users ADD COLUMN lockouts INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE templates ADD COLUMN item_label TEXT NOT NULL DEFAULT 'Item';

  CREATE TABLE app_settings (
    id TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT NOT NULL DEFAULT ''
  );
  `,
  // 3: admin-defined sign-off types ("New (UK)", "New (USA)", "Service"…) — mode stays as the
  //    parts-allowed flag, the picked type is snapshotted by id and name.
  `
  ALTER TABLE signoffs ADD COLUMN type_id TEXT NOT NULL DEFAULT '';
  ALTER TABLE signoffs ADD COLUMN type_name TEXT NOT NULL DEFAULT '';
  `,
  // 4: mechanism history — arrival time per visit, signing time next to the date.
  `
  ALTER TABLE signoffs ADD COLUMN arrived_at TEXT NOT NULL DEFAULT '';
  UPDATE signoffs SET arrived_at = created_at WHERE arrived_at = '';
  CREATE INDEX signoffs_serial_arrived ON signoffs(serial_number COLLATE NOCASE, arrived_at);
  ALTER TABLE signoff_signatures ADD COLUMN time TEXT NOT NULL DEFAULT '';
  `,
];

export function migrate(db: Database.Database): void {
  const current = db.pragma("user_version", { simple: true }) as number;
  for (let i = current; i < MIGRATIONS.length; i++) {
    db.transaction(() => {
      db.exec(MIGRATIONS[i]!);
      db.pragma(`user_version = ${i + 1}`);
    })();
  }
}
