// The single, engine-neutral description of every business table — column names only, every value
// a plain string on the way in/out of the generic row API (Store.tables). Three things are built on
// this one list, so it's the only place a new column has to be declared:
//   - the Google Sheets backup mirror (one tab per table, header row = these columns, in order),
//   - restoring a dead NAS from that mirror,
//   - porting to another database engine (export every table here -> import into the new Store).
// The SQLite adapter's own DDL (sqlite/migrations.ts) must stay column-for-column in sync with it —
// test/store.test.ts round-trips every table through readRows/importRows to catch any drift.
//
// Every mirrored table has `id`, `updated_at` and `deleted_at`: rows are never physically deleted,
// only soft-deleted, so the mirror (an upsert-by-id, see SheetTable.upsert) never has to find and
// remove a row — it just overwrites it with its new deleted_at.

export interface TableSpec {
  name: MirroredTable;
  columns: readonly string[];
}

export type MirroredTable = "app_settings" | "users" | "parts" | "templates" | "signoffs" | "signoff_marks" | "signoff_signatures" | "signoff_parts" | "signoff_photos";

/** In dependency order — restore imports them in exactly this order. */
export const TABLES: readonly TableSpec[] = [
  // Settings that belong to the business, not the server — the printed document's company header,
  // address, footer and logo. One row per key, value = JSON.
  { name: "app_settings", columns: ["id", "value", "updated_at", "deleted_at"] },
  // Deliberately without password_hash (the PIN hash) or any lockout counters: the backup sheet is
  // not a credential store. A restored user comes back locked and needs a new PIN from an admin.
  { name: "users", columns: ["id", "username", "name", "role", "locked", "created_at", "updated_at", "deleted_at"] },
  { name: "parts", columns: ["id", "part_number", "name", "description", "created_at", "updated_at", "deleted_at"] },
  {
    name: "templates",
    columns: [
      "id",
      "name",
      "document_ref",
      "document_id",
      "serial_label",
      "item_label",
      "checks_json",
      "rows_json",
      "sign_row_enabled",
      "sign_row_label",
      "distinct_signers",
      "part_ids_json",
      "created_at",
      "updated_at",
      "deleted_at",
    ],
  },
  {
    name: "signoffs",
    columns: [
      "id",
      "number",
      "template_id",
      "template_json",
      "serial_number",
      "arrived_at",
      "mode",
      "type_id",
      "type_name",
      "status",
      "notes",
      "created_by",
      "created_by_name",
      "created_at",
      "updated_at",
      "deleted_at",
    ],
  },
  { name: "signoff_marks", columns: ["id", "signoff_id", "row_id", "check_id", "value", "by_user_id", "by_name", "at", "updated_at", "deleted_at"] },
  { name: "signoff_signatures", columns: ["id", "signoff_id", "check_id", "user_id", "name", "path", "date", "time", "at", "updated_at", "deleted_at"] },
  { name: "signoff_parts", columns: ["id", "signoff_id", "part_id", "part_number", "name", "qty", "note", "created_at", "updated_at", "deleted_at", "booked_out_at", "booked_out_qty"] },
  // Photo metadata only — the image files themselves stay on the NAS (PHOTOS_PATH), `file` is the
  // path relative to that folder.
  { name: "signoff_photos", columns: ["id", "signoff_id", "check_id", "file", "taken_by", "taken_by_name", "taken_at", "created_at", "updated_at", "deleted_at"] },
];

export function tableSpec(name: string): TableSpec {
  const spec = TABLES.find((t) => t.name === name);
  if (!spec) throw new Error(`Unknown table: ${name}`);
  return spec;
}

export type Row = Record<string, string>;
