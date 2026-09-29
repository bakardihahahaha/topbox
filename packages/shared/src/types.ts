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
  /** Heading of the item column — "Item" by default. */
  itemLabel: string;
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

/** Internal flag behind every sign-off type: "new" = check only, "service" = repaired, replaced
 * parts may be recorded (only then is the replaced-parts section shown). */
export type SignoffMode = "new" | "service";

/** A button on the New sign-off screen — "New (UK)", "New (USA)", "Service"… — defined by an
 * admin in Setup → Types. */
export interface SignoffType {
  id: string;
  name: string;
  /** Small line under the name on the button, e.g. "Check only". */
  description: string;
  /** Service-style: replaced parts can be recorded. */
  allowsParts: boolean;
}

export const DEFAULT_SIGNOFF_TYPES: SignoffType[] = [
  { id: "new-uk", name: "New (UK)", description: "Check only", allowsParts: false },
  { id: "new-usa", name: "New (USA)", description: "Check only", allowsParts: false },
  { id: "service", name: "Service", description: "Repair + replaced parts", allowsParts: true },
];

export const modeOf = (t: Pick<SignoffType, "allowsParts">): SignoffMode => (t.allowsParts ? "service" : "new");

/** Display name for a sign-off, including ones created before types existed. */
export const typeNameOf = (s: { typeName?: string; mode: SignoffMode }) => s.typeName || (s.mode === "service" ? "Service" : "New");

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
  /** HH:MM, local time of the signing device ('' on records from before times were kept). */
  time: string;
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

/** A photo documenting something found during one check. Only the metadata travels with the
 * sign-off; the JPEG itself is stored as a file on the NAS and fetched separately. */
export interface SignoffPhoto {
  id: string;
  checkId: string;
  takenBy: string;
  takenByName: string;
  /** ISO time the photo was taken (on the device). */
  takenAt: string;
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
  /** When the mechanism arrived at the workshop for this visit (ISO) — defaults to when the
   * sign-off was started, editable. */
  arrivedAt: string;
  mode: SignoffMode;
  /** Which sign-off type was picked; its name is snapshotted so renaming/deleting the type later
   * never changes an existing record. Empty on records from before types existed. */
  typeId: string;
  typeName: string;
  notes: string;
  marks: Mark[];
  signatures: Signature[];
  parts: ReplacedPart[];
  /** Photos taken during a check (the image files live on the NAS, see /api/photos/:id). */
  photos: SignoffPhoto[];
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
  typeName: string;
  arrivedAt: string;
  /** "YYYY-MM-DD HH:MM" of the last check's signature once complete — when it left. */
  departedAt: string | null;
  /** "YYYY-MM-DD HH:MM" when the first check was completed (signed), null before. */
  firstCheckAt: string | null;
  firstCheckBy: string | null;
  status: SignoffStatus;
  /** "2/3" — checks signed (or fully marked when the sign row is off) out of total. */
  progress: string;
  createdByName: string;
  createdAt: string;
  updatedAt: string;
}

export type SignoffStatus = "draft" | "complete";

/** admin: everything · operator: does the checks · viewer: looks and downloads PDFs, nothing else. */
export type Role = "admin" | "operator" | "viewer";

/** Company details printed on every PDF page — edited in Setup → Document, shared by all
 * templates (each template keeps its own title, document reference and id). */
export interface DocumentSettings {
  /** Logo as plain black text, used when no logo image is uploaded. */
  logoText: string;
  /** PNG/JPEG data URL; replaces the text logo when set. */
  logoDataUrl: string;
  companyName: string;
  /** Top-right address block, one line per line (street, city, postcode, tel, web…). */
  address: string;
  /** Centred line at the very bottom (registration details). */
  footerText: string;
  /** Printed before the template's document id in the footer. */
  documentIdLabel: string;
}

export const DEFAULT_DOCUMENT_SETTINGS: DocumentSettings = {
  logoText: "BIOSITE",
  logoDataUrl: "",
  companyName: "Biosite Systems Ltd.",
  address: "Lancaster House\nDrayton Road, Solihull, UK\nB90 4NG\nTel: +44(0)121 374 2939\nwww.biositesystems.com",
  footerText: "Biosite Systems Ltd, registered in England and Wales. Reg. No. 7308880",
  documentIdLabel: "Document Identifier:",
};

/** One tile on the sign-in screen. */
export interface LoginUser {
  id: string;
  name: string;
  /** Set while a temporary lockout (3 wrong PINs) is running. */
  lockedUntil: string | null;
}

export const PIN_PATTERN = /^\d{4,8}$/;

/** One physical mechanism (serial number) across all its visits to the workshop. */
export interface MechanismSummary {
  serialNumber: string;
  visits: number;
  /** The latest visit. */
  last: SignoffSummary;
  /** Latest visit complete = it has left and is out at a client. */
  atClient: boolean;
}

/** Who may do what beyond the fixed rules (Setup → Security). */
export interface Permissions {
  /** Who sees and may use "Delete sign-off". */
  deleteSignoffs: "admin" | "all";
}

export const DEFAULT_PERMISSIONS: Permissions = { deleteSignoffs: "admin" };
