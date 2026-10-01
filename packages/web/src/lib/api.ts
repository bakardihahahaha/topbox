import type { Role, DocumentSettings, MarkValue, Part, PartInput, Signoff, SignoffMode, SignoffSummary, Template, TemplateInput } from "@biosite-signoff/shared";
import { getJson, getJsonCached, sendJson } from "./client.js";

export const listTemplates = () => getJsonCached<Template[]>("/api/templates");
export const getTemplate = (id: string) => getJsonCached<Template>(`/api/templates/${id}`);
export const createTemplate = (id: string, input: TemplateInput) => sendJson<Template>("POST", "/api/templates", { ...input, id });
export const updateTemplate = (id: string, input: TemplateInput) => sendJson<Template>("PUT", `/api/templates/${id}`, input);
export const duplicateTemplate = (id: string) => sendJson<Template>("POST", `/api/templates/${id}/duplicate`);
export const deleteTemplate = (id: string) => sendJson("DELETE", `/api/templates/${id}`);

export const listParts = () => getJsonCached<Part[]>("/api/parts");
export const createPart = (id: string, input: PartInput) => sendJson<Part>("POST", "/api/parts", { ...input, id });
export const reorderParts = (ids: string[]) => sendJson<Part[]>("PUT", "/api/parts/order", { ids });
export const updatePart = (id: string, patch: Partial<PartInput>) => sendJson<Part>("PATCH", `/api/parts/${id}`, patch);
export const deletePart = (id: string) => sendJson("DELETE", `/api/parts/${id}`);

export const getSignoff = (id: string) => getJson<Signoff>(`/api/signoffs/${id}`);
/** Full records for many sign-offs (for a PDF) — fetched 100 at a time, in the order given. */
export async function getSignoffs(ids: string[]): Promise<Signoff[]> {
  const out: Signoff[] = [];
  for (let i = 0; i < ids.length; i += 100) out.push(...(await sendJson<Signoff[]>("POST", "/api/signoffs/batch", { ids: ids.slice(i, i + 100) })));
  return out;
}
export const createSignoff = (input: { id: string; templateId: string; serialNumber: string; typeId?: string; mode?: SignoffMode; arrivedAt?: string }) => sendJson<Signoff>("POST", "/api/signoffs", input);
export const updateSignoffHeader = (id: string, patch: { serialNumber?: string; notes?: string; typeId?: string; mode?: SignoffMode; arrivedAt?: string }) => sendJson<Signoff>("PATCH", `/api/signoffs/${id}`, patch);
export const deleteSignoff = (id: string) => sendJson("DELETE", `/api/signoffs/${id}`);
export type DeletedSignoff = SignoffSummary & { deletedAt: string; deletedBy: string };
export const getDeletedSignoffs = () => getJson<DeletedSignoff[]>("/api/signoffs-deleted");
export const getDeletedCount = () => getJson<{ count: number }>("/api/signoffs-deleted/count");
export const restoreSignoff = (id: string) => sendJson("POST", `/api/signoffs/${id}/restore`);
export const deleteSignoffForever = (id: string) => sendJson("DELETE", `/api/signoffs/${id}/forever`);
export const setMark = (id: string, rowId: string, checkId: string, value: MarkValue | null) => sendJson<Signoff>("PUT", `/api/signoffs/${id}/marks`, { rowId, checkId, value });
export const fillCheck = (id: string, checkId: string, value: MarkValue) => sendJson<Signoff>("POST", `/api/signoffs/${id}/marks/fill`, { checkId, value });
export const signCheck = (id: string, checkId: string, path: string, date: string, time?: string) => sendJson<Signoff>("PUT", `/api/signoffs/${id}/signatures/${checkId}`, { path, date, time });
export const clearCheck = (id: string, checkId: string) => sendJson<Signoff>("POST", `/api/signoffs/${id}/marks/clear`, { checkId });
export const getAllSignoffSummaries = () => getJsonCached<SignoffSummary[]>("/api/signoff-summaries");
export const getSignoffsOfType = (typeId: string) => getJsonCached<SignoffSummary[]>(`/api/types/${encodeURIComponent(typeId)}/signoffs`);
export const getVisits = (serial: string) => getJsonCached<Signoff[]>(`/api/mechanisms/${encodeURIComponent(serial)}/visits`);
export const unsignCheck = (id: string, checkId: string) => sendJson<Signoff>("DELETE", `/api/signoffs/${id}/signatures/${checkId}`);
export const setPartLine = (id: string, lineId: string, partId: string, qty: number, note: string) => sendJson<Signoff>("PUT", `/api/signoffs/${id}/parts/${lineId}`, { partId, qty, note });
export const addPhoto = (id: string, photoId: string, checkId: string, dataUrl: string, takenAt: string, asUserId?: string) => sendJson<Signoff>("POST", `/api/signoffs/${id}/photos`, { photoId, checkId, dataUrl, takenAt, asUserId });
export const removePhoto = (id: string, photoId: string) => sendJson<Signoff>("DELETE", `/api/signoffs/${id}/photos/${photoId}`);
export const removePartLine = (id: string, lineId: string) => sendJson<Signoff>("DELETE", `/api/signoffs/${id}/parts/${lineId}`);

// ---- admin ----

export interface UserSummary {
  id: string;
  name: string;
  role: Role;
  locked: boolean;
  lockedUntil: string | null;
  activeSessions: { ip: string; lastActivityAt: string }[];
  /** May start new sign-offs and do the 1st check. */
  canStart: boolean;
  /** Has an RFID card assigned. */
  hasCard: boolean;
  createdAt: string;
}
export const listUsers = () => getJson<UserSummary[]>("/api/users");
export const createUser = (input: { name: string; role: Role; pin?: string; canStart?: boolean }) => sendJson<{ id: string; pin: string }>("POST", "/api/users", input);
export const updateUser = (id: string, patch: { name?: string; role?: Role; locked?: boolean; canStart?: boolean }) => sendJson<UserSummary>("PATCH", `/api/users/${id}`, patch);
export const assignCard = (id: string, card: string) => sendJson<UserSummary>("PUT", `/api/users/${id}/card`, { card });
export const removeCard = (id: string) => sendJson<UserSummary>("DELETE", `/api/users/${id}/card`);
export const setUserPin = (id: string, pin?: string) => sendJson<{ pin: string }>("POST", `/api/users/${id}/pin`, pin ? { pin } : {});
export const deleteUser = (id: string) => sendJson("DELETE", `/api/users/${id}`);
export const endSessions = (id: string) => sendJson("POST", `/api/users/${id}/end-sessions`);
export const changeOwnPin = (current: string, next: string) => sendJson("POST", "/api/auth/pin", { current, next });

export const getDocumentSettings = () => getJson<DocumentSettings>("/api/document-settings");
export const saveDocumentSettings = (s: DocumentSettings) => sendJson<DocumentSettings>("PUT", "/api/document-settings", s);

export interface SecuritySettings {
  idleTimeoutMinutes: number;
  singleIp: boolean;
  /** After tapping their RFID card, people still type their PIN. */
  cardNeedsPin: boolean;
}
export const getSecurity = () => getJson<SecuritySettings>("/api/security");
export const setSecurity = (patch: Partial<SecuritySettings>) => sendJson<SecuritySettings>("PATCH", "/api/security", patch);

export interface BackupStatus {
  configured: boolean;
  spreadsheetId: string | null;
  credentials: boolean;
  pending: number;
  lastSuccessAt: string | null;
  lastError: string | null;
  lastErrorAt: string | null;
  backoffUntil: string | null;
}
export const getBackupStatus = () => getJson<BackupStatus>("/api/backup/status");
export const setBackupSpreadsheet = (spreadsheet: string) => sendJson<BackupStatus>("PUT", "/api/backup/config", { spreadsheet });
export const syncBackupNow = () => sendJson<{ mirrored: number; status: BackupStatus }>("POST", "/api/backup/sync-now");
export const resyncBackup = () => sendJson<{ queued: number }>("POST", "/api/backup/resync-all");
export const inspectBackup = () => getJson<{ table: string; sheetRows: number; localRows: number }[]>("/api/backup/inspect");
export const wipeDatabase = (scope: "signoffs" | "everything") => sendJson<{ ok: true; scope: string; mirror: string }>("POST", "/api/admin/wipe", { scope, confirm: "DELETE" });
export const restoreBackup = (force: boolean) => sendJson<{ restored: Record<string, number> }>("POST", `/api/backup/restore${force ? "?force=1" : ""}`, { confirm: "RESTORE" });

export interface AuditRow {
  id: string;
  actorName: string | null;
  action: string;
  entity: string;
  entityId: string | null;
  detail: unknown;
  ip: string | null;
  at: string;
}
export const listAudit = (limit = 300) => getJson<AuditRow[]>(`/api/audit?limit=${limit}`);
