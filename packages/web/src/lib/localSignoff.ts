import { modeOf, type Part, type Signoff, type SignoffType, type Template } from "@biosite-signoff/shared";
import type { QueuedAction } from "./offlineQueue.js";
import type { Me } from "./client.js";

const today = () => new Date().toISOString().slice(0, 10);

/** A brand-new sign-off built locally — shown immediately (even offline) while the create request
 * syncs in the background. The server assigns the real SO number; until then it reads "pending". */
export function draftSignoff(input: { id: string; serialNumber: string; arrivedAt?: string }, type: SignoffType, template: Template, me: Me): Signoff {
  const now = new Date().toISOString();
  return {
    id: input.id,
    number: "SO-(pending)",
    templateId: template.id,
    template,
    serialNumber: input.serialNumber,
    arrivedAt: input.arrivedAt ?? now,
    mode: modeOf(type),
    typeId: type.id,
    typeName: type.name,
    notes: "",
    marks: [],
    signatures: [],
    parts: [],
    photos: [],
    createdBy: me.userId,
    createdByName: me.name,
    createdAt: now,
    updatedAt: now,
  };
}

/** Mirrors what the server does for each queued action, so the screen can update optimistically
 * and replay still-queued writes on top of a freshly fetched copy. Validation stays on the server
 * — this only ever applies changes the UI already allowed. */
export function applyLocal(s: Signoff, a: QueuedAction, me: Me, parts: Part[], types: SignoffType[] = []): Signoff {
  const at = new Date().toISOString();
  switch (a.kind) {
    case "updateHeader": {
      const { typeId, mode, ...rest } = a.patch;
      const type = typeId ? types.find((t) => t.id === typeId) : undefined;
      return { ...s, ...rest, ...(type ? { typeId: type.id, typeName: type.name, mode: modeOf(type) } : mode ? { mode } : {}) };
    }
    case "setMark": {
      const marks = s.marks.filter((m) => !(m.rowId === a.rowId && m.checkId === a.checkId));
      if (a.value) marks.push({ rowId: a.rowId, checkId: a.checkId, value: a.value, byUserId: me.userId, byName: me.name, at });
      return { ...s, marks };
    }
    case "fillCheck": {
      const have = new Set(s.marks.filter((m) => m.checkId === a.checkId).map((m) => m.rowId));
      const added = s.template.rows
        .filter((r) => r.kind === "item" && !have.has(r.id))
        .map((r) => ({ rowId: r.id, checkId: a.checkId, value: a.value, byUserId: me.userId, byName: me.name, at }));
      return { ...s, marks: [...s.marks, ...added] };
    }
    case "clearCheck":
      return { ...s, marks: s.marks.filter((m) => m.checkId !== a.checkId) };
    case "sign":
      return {
        ...s,
        signatures: [...s.signatures.filter((x) => x.checkId !== a.checkId), { checkId: a.checkId, userId: me.userId, name: me.name, path: a.path, date: a.date || today(), time: a.time ?? "", at }],
      };
    case "unsign":
      return { ...s, signatures: s.signatures.filter((x) => x.checkId !== a.checkId) };
    case "setPart": {
      const existing = s.parts.find((p) => p.id === a.lineId);
      const part = parts.find((p) => p.id === a.partId);
      const line = { id: a.lineId, partId: a.partId, partNumber: existing?.partNumber ?? part?.partNumber ?? "", name: existing?.name ?? part?.name ?? "", qty: a.qty, note: a.note };
      return { ...s, parts: existing ? s.parts.map((p) => (p.id === a.lineId ? line : p)) : [...s.parts, line] };
    }
    case "removePart":
      return { ...s, parts: s.parts.filter((p) => p.id !== a.lineId) };
    case "addPhoto":
      if ((s.photos ?? []).some((p) => p.id === a.photoId)) return s;
      return { ...s, photos: [...(s.photos ?? []), { id: a.photoId, checkId: a.checkId, takenBy: me.userId, takenByName: me.name, takenAt: a.takenAt }] };
    case "removePhoto":
      return { ...s, photos: (s.photos ?? []).filter((p) => p.id !== a.photoId) };
    default:
      return s;
  }
}
