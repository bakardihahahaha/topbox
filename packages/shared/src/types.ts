// The whole domain model in one place — shared by the server (validation, storage) and the web
// app (screens, the client-side PDF generator), so both halves always agree on the exact shape.

/** A column of the checklist grid — "1st Check", "2nd Check", "3rd Check", … Each column is a
 * separate pass over every item, usually done by a different person at a different time, and
 * (when the template's sign row is on) carries its own signature + date. */
export interface TemplateCheck {
  /** Stable across edits — marks and signatures on a sign-off reference this, never the
   * column's position, so reordering/renaming columns never misattributes a tick. */
  id: string;
  label: string;
}

/** "item" = a row that gets a mark in every check column. "section" = a heading row such as
 * "Security red paint on:" that is never marked itself (printed with dashes in the check
 * columns, exactly like the paper form). */
export type TemplateRowKind = "item" | "section";

export interface TemplateRow {
  id: string;
  kind: TemplateRowKind;
  text: string;
  bold: boolean;
  /** Indents the row under the previous section heading — the paper form's sub-items. */
  indent: boolean;
}

/** One product/mechanism checklist definition — e.g. PA-DOC-189 "Mechanism Checklist". */
export interface Template {
  id: string;
  name: string;
  /** Printed in the page header, e.g. "PA-DOC-189, revision 6, released 23-May-2019". */
  documentRef: string;
  /** Printed in the footer, e.g. "PA-DOC-189-006". */
  documentId: string;
  /** Label of the identifier box at the top of the table — "Serial Number" by default. */
  serialLabel: string;
  checks: TemplateCheck[];
  rows: TemplateRow[];
  /** "Sign and date here" row — when on, every check column gets its own signature + date. */
  signRowEnabled: boolean;
  signRowLabel: string;
  /** When on, the same person can't sign two check columns of one sign-off — an independent
   * second check has to be a second pair of eyes. */
  distinctSigners: boolean;
  /** Which predefined parts can be ticked as replaced on a *service* sign-off of this template.
   * Empty = this mechanism never has parts replaced (the parts section is hidden entirely). */
  partIds: string[];
  createdAt: string;
  updatedAt: string;
}

export type TemplateInput = Omit<Template, "id" | "createdAt" | "updatedAt">;

/** A predefined, replaceable part — defined once by an admin, then just ticked by operators. */
export interface Part {
  id: string;
  partNumber: string;
  name: string;
  description: string;
  createdAt: string;
  updatedAt: string;
}

export type PartInput = Pick<Part, "partNumber" | "name" | "description">;

/** "new" mechanisms are only checked. "service" mechanisms are repaired and may have parts
 * replaced — only a service sign-off shows the replaced-parts section. */
export type SignoffMode = "new" | "service";

export type MarkValue = "pass" | "fail" | "na";

export interface Mark {
  rowId: string;
  checkId: string;
  value: MarkValue;
  byUserId: string;
  byName: string;
  at: string;
}

/** A signature is stored as SVG path data ("M12 40L13 41…") in a 300x100 box rather than a PNG
 * data URL — a few hundred bytes instead of tens of KB, crisp at any print size, and small
 * enough to always fit in a single Google Sheets cell on the backup mirror. */
export interface Signature {
  checkId: string;
  userId: string;
  name: string;
  path: string;
  /** YYYY-MM-DD — the date printed next to the signature. */
  date: string;
  at: string;
}

export interface ReplacedPart {
  id: string;
  partId: string;
  /** Snapshotted at the time of ticking, so renaming a part later never rewrites history. */
  partNumber: string;
  name: string;
  qty: number;
  note: string;
}

export interface Signoff {
  id: string;
  /** Human-facing running number (SO-000123). */
  number: string;
  templateId: string;
  /** Frozen copy of the template as it was when this sign-off was started — editing a template
   * later (new rows, renamed checks) never changes what an existing record shows or prints. */
  template: Template;
  serialNumber: string;
  mode: SignoffMode;
  notes: string;
  marks: Mark[];
  signatures: Signature[];
  parts: ReplacedPart[];
  createdBy: string;
  createdByName: string;
  createdAt: string;
  updatedAt: string;
}

export interface SignoffSummary {
  id: string;
  number: string;
  templateId: string;
  templateName: string;
  serialNumber: string;
  mode: SignoffMode;
  status: SignoffStatus;
  /** "2/3" — checks signed (or fully marked when the sign row is off) out of total. */
  progress: string;
  createdByName: string;
  createdAt: string;
  updatedAt: string;
}

export type SignoffStatus = "draft" | "complete";

export type Role = "admin" | "operator";
