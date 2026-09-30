import { DEFAULT_PERMISSIONS, MIN_SIGNATURE_LENGTH, crossCheckBlock, isRefurbishToggle, oncePerTopboxBlock, photoBlock, refurbishedRBlock, typeLocked, allowedPartIds, signatureLength, summarize, isCheckFullyMarked, itemRows, signoffProgress, signoffStatus, typeNameOf, type MarkValue, type Signoff, type SignoffMode, type SignoffSummary, type MechanismSummary, type Permissions, type Role } from "@biosite-signoff/shared";
import type { SignoffTypesService } from "./signoffTypes.js";
import { PhotoFiles } from "./photoFiles.js";
import type { SignoffListFilter, Store } from "../store/Store.js";
import { HttpError, badRequest, conflict, forbidden, notFound } from "./errors.js";

export const PERMISSIONS_KEY = "permissions";

export interface Actor {
  userId: string;
  role: Role;
  name: string;
}

export const formatNumber = (n: number) => `SO-${String(n).padStart(6, "0")}`;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
// SignaturePad emits only absolute M/L commands with integer coordinates.
const PATH_RE = /^[ML0-9 .-]+$/;

export class SignoffService {
  constructor(
    private readonly store: Store,
    private readonly types: SignoffTypesService,
    private readonly photoFiles: PhotoFiles,
  ) {}

  private async require(id: string) {
    const s = await this.store.signoffs.get(id);
    if (!s) throw notFound("Sign-off");
    return s;
  }

  /** A TopBox's earlier visits are history: operators may look (and print), never change them —
   * only its latest visit is worked on. Admins may still correct an old visit. */
  private async assertCurrentVisit(s: Signoff, actor: Actor): Promise<void> {
    if (actor.role === "admin") return;
    const visits = await this.visits(s.serialNumber);
    const latest = visits[visits.length - 1];
    if (latest && latest.id !== s.id) {
      throw conflict("OLD_VISIT", `This is an earlier visit of ${s.serialNumber} — it's history now. Only an admin can change it.`);
    }
  }

  /** "Only once per TopBox" types (Setup → Types), e.g. New: refused when the TopBox already had one. */
  private async assertTypeAllowed(serial: string, typeId: string, selfId?: string): Promise<void> {
    const types = await this.types.list();
    const type = types.find((t) => t.id === typeId);
    if (!type) return;
    const block = oncePerTopboxBlock(serial, await this.visits(serial), type, selfId);
    if (block) throw conflict("TYPE_ONCE_ONLY", block);
  }

  /** The refurbished "R" only on types that allow it (Setup → Types). */
  private async assertSerialFitsType(serial: string, typeId: string): Promise<void> {
    const type = (await this.types.list()).find((t) => t.id === typeId);
    if (!type) return;
    const block = refurbishedRBlock(serial, type);
    if (block) throw conflict("R_NOT_ALLOWED", block);
  }

  /** The sign-off, if this person may change it (see assertCurrentVisit). */
  private async requireWritable(id: string, actor: Actor) {
    const s = await this.require(id);
    await this.assertCurrentVisit(s, actor);
    return s;
  }

  /** Recomputes the stored status column (used for list filtering) after every change. */
  private async refresh(id: string): Promise<Signoff> {
    const s = await this.require(id);
    const status = signoffStatus(s);
    if (s.status !== status) {
      await this.store.signoffs.setStatus(id, status, new Date().toISOString());
      s.status = status;
    }
    return s;
  }

  toSummary(s: Signoff): SignoffSummary {
    return summarize(s);
  }

  async list(filter: SignoffListFilter): Promise<{ items: SignoffSummary[]; total: number }> {
    const { items, total } = await this.store.signoffs.list(filter);
    return { items: items.map((s) => this.toSummary(s)), total };
  }

  get(id: string): Promise<Signoff> {
    return this.require(id);
  }

  /** `id` comes from the client so a queued/retried create is idempotent. */
  async create(input: { id: string; templateId: string; serialNumber: string; typeId?: string; mode?: SignoffMode; arrivedAt?: string }, actor: Actor): Promise<Signoff> {
    const existing = await this.store.signoffs.get(input.id);
    if (existing) return existing;
    const template = await this.store.templates.get(input.templateId);
    if (!template) throw notFound("Template");
    const serialNumber = input.serialNumber.trim();
    if (!serialNumber) throw badRequest("Serial number is required.");
    const type = await this.types.resolve(input);
    await this.assertTypeAllowed(serialNumber, type.typeId);
    await this.assertSerialFitsType(serialNumber, type.typeId);
    const now = new Date().toISOString();
    // A number collision (two creates racing) just retries with the next number.
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        await this.store.signoffs.create({
          id: input.id,
          number: formatNumber(await this.store.signoffs.nextNumber()),
          templateId: template.id,
          template,
          serialNumber,
          ...type,
          status: "draft",
          notes: "",
          createdBy: actor.userId,
          createdByName: actor.name,
          arrivedAt: input.arrivedAt ?? now,
          createdAt: now,
          updatedAt: now,
        });
        break;
      } catch (err) {
        if (attempt === 4 || !String(err).includes("UNIQUE")) throw err;
      }
    }
    return this.require(input.id);
  }

  async updateHeader(id: string, patch: { serialNumber?: string; notes?: string; typeId?: string; mode?: SignoffMode; arrivedAt?: string }, actor: Actor): Promise<Signoff> {
    if (patch.arrivedAt !== undefined && Number.isNaN(Date.parse(patch.arrivedAt))) throw badRequest("Invalid arrival time.");
    const s = await this.requireWritable(id, actor);
    // Serial number and arrival are fixed once a sign-off is started — only an admin corrects them.
    // The one exception: an operator may add (or take back) the refurbished "R" (667 → 667R).
    if (actor.role !== "admin") {
      if (patch.arrivedAt !== undefined) throw forbidden("Only an admin can change the arrival time.");
      if (patch.serialNumber !== undefined && patch.serialNumber.trim() !== s.serialNumber && !isRefurbishToggle(s.serialNumber, patch.serialNumber)) {
        throw forbidden('Only an admin can change the serial number — you can only add or remove the refurbished "R".');
      }
      // The type is what the mechanism was checked as — fixed once the first check is signed.
      const typeChange = patch.mode !== undefined || (patch.typeId !== undefined && patch.typeId !== s.typeId);
      if (typeChange && typeLocked(s)) {
        throw forbidden(`This was checked as ${typeNameOf(s)} — the type can't change after the first check. A mechanism coming back starts a new visit (e.g. as Service).`);
      }
    }
    this.assertEditable(s, actor);
    if (patch.serialNumber !== undefined && !patch.serialNumber.trim()) throw badRequest("Serial number is required.");
    const type = patch.typeId !== undefined || patch.mode !== undefined ? await this.types.resolve(patch) : undefined;
    if (type && type.typeId !== s.typeId) await this.assertTypeAllowed(s.serialNumber, type.typeId, s.id);
    if (patch.serialNumber !== undefined || type) await this.assertSerialFitsType(patch.serialNumber?.trim() || s.serialNumber, type?.typeId ?? s.typeId);
    if (type?.mode === "new" && s.parts.length > 0) {
      throw conflict("HAS_PARTS", `Remove the replaced parts before switching this sign-off to ${type.typeName || "a check-only type"}.`);
    }
    await this.store.signoffs.updateHeader(id, { serialNumber: patch.serialNumber?.trim(), notes: patch.notes, arrivedAt: patch.arrivedAt, ...type }, new Date().toISOString());
    return this.refresh(id);
  }

  async remove(id: string, actor: Actor): Promise<void> {
    const s = await this.store.signoffs.get(id);
    if (!s) return;
    await this.assertCurrentVisit(s, actor);
    if (actor.role !== "admin" && (await this.permissions()).deleteSignoffs !== "all") {
      throw forbidden("Only an admin can delete sign-offs.");
    }
    await this.store.signoffs.softDelete(id, new Date().toISOString());
  }

  async permissions(): Promise<Permissions> {
    const raw = await this.store.appSettings.get(PERMISSIONS_KEY);
    return { ...DEFAULT_PERMISSIONS, ...(raw ? (JSON.parse(raw) as Partial<Permissions>) : {}) };
  }

  async setPermissions(p: Permissions): Promise<Permissions> {
    await this.store.appSettings.set(PERMISSIONS_KEY, JSON.stringify(p));
    return this.permissions();
  }

  /** A completed sign-off (every check signed) is a closed record — operators can't change its
   * parts, notes or type any more; an admin still can. */
  private assertEditable(s: Signoff, actor: Actor) {
    if (actor.role !== "admin" && signoffStatus(s) === "complete") {
      throw conflict("COMPLETED", "This sign-off is complete — only an admin can change it now.");
    }
  }

  private assertCheck(s: Signoff, checkId: string) {
    if (!s.template.checks.some((c) => c.id === checkId)) throw badRequest("Unknown check column.");
  }

  private assertNotSigned(s: Signoff, checkId: string) {
    if (s.signatures.some((sig) => sig.checkId === checkId)) {
      throw conflict("CHECK_SIGNED", "This check is already signed — remove the signature first to change its marks.");
    }
  }

  async setMark(id: string, input: { rowId: string; checkId: string; value: MarkValue | null }, actor: Actor): Promise<Signoff> {
    const s = await this.requireWritable(id, actor);
    this.assertCheck(s, input.checkId);
    if (!itemRows(s.template).some((r) => r.id === input.rowId)) throw badRequest("Unknown item row.");
    this.assertNotSigned(s, input.checkId);
    const at = new Date().toISOString();
    if (input.value === null) await this.store.signoffs.clearMark(id, input.rowId, input.checkId, at);
    else await this.store.signoffs.upsertMark(id, { rowId: input.rowId, checkId: input.checkId, value: input.value, byUserId: actor.userId, byName: actor.name, at });
    return this.refresh(id);
  }

  /** "Tick all" — marks every still-empty item in one check column (never overwrites a ✗). */
  /** "✕ all" — clears every mark in one (unsigned) check column. */
  async clearCheck(id: string, checkId: string, actor: Actor): Promise<Signoff> {
    const s = await this.requireWritable(id, actor);
    this.assertCheck(s, checkId);
    this.assertNotSigned(s, checkId);
    await this.store.signoffs.clearMarks(id, checkId, new Date().toISOString());
    return this.refresh(id);
  }

  /** Every mechanism (serial number) with its latest visit — where it is right now. */
  async mechanisms(search: string | undefined, limit: number): Promise<MechanismSummary[]> {
    const out: MechanismSummary[] = [];
    for (const r of await this.store.signoffs.serials(search, limit)) {
      const last = await this.store.signoffs.get(r.lastId);
      if (!last) continue;
      const summary = this.toSummary(last);
      out.push({ serialNumber: last.serialNumber, visits: r.visits, completedVisits: r.completedVisits, last: summary, atClient: summary.status === "complete" });
    }
    return out;
  }

  /** "In stock" for one sign-off type — the home screen's tabs: mechanisms whose first check is
   * done but that haven't completed (left) yet. Check-only types sort by serial number (highest
   * first, numbers compared as numbers); parts-allowing (service) types by when the first check
   * was done, most recent first. */
  async stock(typeId: string): Promise<SignoffSummary[]> {
    const type = (await this.types.list()).find((t) => t.id === typeId);
    const items = (await this.store.signoffs.list({ typeId, status: "draft", limit: 5000, offset: 0 })).items.map((s) => summarize(s)).filter((s) => s.firstCheckAt);
    if (type?.allowsParts) return items.sort((a, b) => b.firstCheckAt!.localeCompare(a.firstCheckAt!));
    return items.sort((a, b) => b.serialNumber.localeCompare(a.serialNumber, undefined, { numeric: true, sensitivity: "base" }));
  }

  /** Every sign-off (visit) ever made as this type — the home screen's type tabs. Highest serial
   * number first (numbers compared as numbers); the screen re-sorts and filters. */
  async ofType(typeId?: string): Promise<SignoffSummary[]> {
    const items = (await this.store.signoffs.list({ typeId: typeId || undefined, limit: 100_000, offset: 0 })).items.map((s) => summarize(s));
    return items.sort((a, b) => b.serialNumber.localeCompare(a.serialNumber, undefined, { numeric: true, sensitivity: "base" }));
  }

  /** Parts used — replaced-part lines recorded in [from, to), for booking them out of stock. */
  partsUsage(from: string, to: string) {
    return this.store.signoffs.partsUsage(from, to);
  }

  /** Admin or a "parts" account: mark lines as booked out of stock in the stock system (or undo). */
  async setPartsBookedOut(lineIds: string[], booked: boolean, actor: Actor): Promise<number> {
    if (actor.role !== "admin" && actor.role !== "parts") throw forbidden("Only an admin or a Parts used account can mark parts as booked out.");
    const now = new Date().toISOString();
    return this.store.signoffs.setPartsBookedOut(lineIds, booked ? now : "", now);
  }

  /** All visits of one mechanism, oldest first. */
  async visits(serial: string): Promise<Signoff[]> {
    return (await this.store.signoffs.list({ serial, order: "arrived_asc", limit: 1000, offset: 0 })).items;
  }

  async fillCheck(id: string, input: { checkId: string; value: MarkValue }, actor: Actor): Promise<Signoff> {
    const s = await this.requireWritable(id, actor);
    this.assertCheck(s, input.checkId);
    this.assertNotSigned(s, input.checkId);
    const marked = new Set(s.marks.filter((m) => m.checkId === input.checkId).map((m) => m.rowId));
    const at = new Date().toISOString();
    const marks = itemRows(s.template)
      .filter((r) => !marked.has(r.id))
      .map((r) => ({ rowId: r.id, checkId: input.checkId, value: input.value, byUserId: actor.userId, byName: actor.name, at }));
    await this.store.signoffs.upsertMarks(id, marks);
    return this.refresh(id);
  }

  async sign(id: string, input: { checkId: string; path: string; date: string; time?: string }, actor: Actor): Promise<Signoff> {
    const s = await this.requireWritable(id, actor);
    this.assertCheck(s, input.checkId);
    if (!s.template.signRowEnabled) throw badRequest("This template has no sign row.");
    if (!DATE_RE.test(input.date)) throw badRequest("Date must be YYYY-MM-DD.");
    if (input.time !== undefined && input.time !== "" && !/^([01]\d|2[0-3]):[0-5]\d$/.test(input.time)) throw badRequest("Time must be HH:MM.");
    if (!input.path || input.path.length > 40_000 || !PATH_RE.test(input.path)) throw badRequest("Invalid signature.");
    if (signatureLength(input.path) < MIN_SIGNATURE_LENGTH) throw new HttpError(400, "SIGNATURE_EMPTY", "Please sign properly — the signature box can't be empty or just a dot.");
    const existing = s.signatures.find((sig) => sig.checkId === input.checkId);
    // Re-sending the same user's signature (a retried request) just overwrites it; someone else's
    // signature is never silently replaced.
    if (existing && existing.userId !== actor.userId) throw conflict("ALREADY_SIGNED", `Already signed by ${existing.name}.`);
    if (!isCheckFullyMarked(s, input.checkId)) throw conflict("CHECK_INCOMPLETE", "Mark every item in this check before signing it.");
    if (s.template.distinctSigners && s.signatures.some((sig) => sig.checkId !== input.checkId && sig.userId === actor.userId)) {
      throw conflict("SAME_SIGNER", "You already signed another check on this sign-off — this one needs a different person.");
    }
    const block = crossCheckBlock(s, input.checkId, actor, await this.operatorCount());
    if (block) throw conflict("CROSS_CHECK", block);
    await this.store.signoffs.upsertSignature(id, { checkId: input.checkId, userId: actor.userId, name: actor.name, path: input.path, date: input.date, time: input.time ?? "", at: new Date().toISOString() });
    return this.refresh(id);
  }

  /** Operators in the system — the cross-check rule spreads checks over them. */
  async operatorCount(): Promise<number> {
    return (await this.store.users.list()).filter((u) => u.role === "operator").length;
  }

  async unsign(id: string, checkId: string, actor: Actor): Promise<Signoff> {
    const s = await this.require(id);
    const existing = s.signatures.find((sig) => sig.checkId === checkId);
    if (!existing) return s;
    // A signature is permanent — only an admin can take one back.
    if (actor.role !== "admin") throw forbidden("Only an admin can remove a signature.");
    await this.store.signoffs.clearSignature(id, checkId, new Date().toISOString());
    return this.refresh(id);
  }

  /** `partRowId` is client-generated, so a retried add lands on the same row. */
  async setPart(id: string, partRowId: string, input: { partId: string; qty: number; note: string }, actor: Actor): Promise<Signoff> {
    const s = await this.requireWritable(id, actor);
    this.assertEditable(s, actor);
    if (s.mode !== "service") throw conflict("NOT_SERVICE", `Parts can't be recorded on a ${typeNameOf(s)} sign-off — only on a type that allows replaced parts.`);
    const allowed = allowedPartIds(s.template, await this.store.templates.get(s.templateId));
    if (allowed !== "all" && !allowed.has(input.partId)) {
      throw badRequest("This part isn't in this checklist's parts list (Setup → Templates).");
    }
    if (!Number.isInteger(input.qty) || input.qty < 1 || input.qty > 999) throw badRequest("Quantity must be 1–999.");
    const existingLine = s.parts.find((p) => p.id === partRowId);
    // Snapshot the part's number/name — from the live catalog when first added, kept thereafter.
    let partNumber = existingLine?.partNumber;
    let name = existingLine?.name;
    if (!existingLine) {
      const part = await this.store.parts.get(input.partId);
      if (!part) throw notFound("Part");
      if (s.parts.some((p) => p.partId === input.partId)) throw conflict("PART_ALREADY_ADDED", `${part.name} is already on this sign-off — change its quantity instead.`);
      partNumber = part.partNumber;
      name = part.name;
    }
    await this.store.signoffs.upsertPart(id, { id: partRowId, partId: input.partId, partNumber: partNumber!, name: name!, qty: input.qty, note: input.note.trim() }, new Date().toISOString());
    return this.refresh(id);
  }

  /** Stores a photo taken during one check. `photoId` comes from the client, so a retried upload
   * from the offline queue lands on the same photo. */
  async addPhoto(id: string, input: { photoId: string; checkId: string; jpeg: Buffer; takenAt?: string; asUserId?: string }, actor: Actor): Promise<Signoff> {
    const s = await this.requireWritable(id, actor);
    this.assertCheck(s, input.checkId);
    if (s.photos.some((p) => p.id === input.photoId)) return s;
    this.assertEditable(s, actor);
    const block = photoBlock(s, input.checkId, actor, await this.operatorCount());
    if (block) throw forbidden(block);
    if (input.jpeg.length < 100 || input.jpeg[0] !== 0xff || input.jpeg[1] !== 0xd8) throw badRequest("The photo must be a JPEG image.");
    // Only an admin may record a photo in another person's name.
    let takenBy = { userId: actor.userId, name: actor.name };
    if (input.asUserId && input.asUserId !== actor.userId) {
      if (actor.role !== "admin") throw forbidden("Only an admin can add a photo as another operator.");
      const u = await this.store.users.get(input.asUserId);
      if (!u) throw notFound("User");
      takenBy = { userId: u.id, name: u.name || u.username };
    }
    const now = new Date().toISOString();
    const takenAt = input.takenAt && !Number.isNaN(Date.parse(input.takenAt)) ? input.takenAt : now;
    const check = s.template.checks.find((c) => c.id === input.checkId)!;
    const file = PhotoFiles.fileName(s.serialNumber, check.label, takenAt, input.photoId);
    await this.photoFiles.write(file, input.jpeg);
    await this.store.signoffs.addPhoto(id, { id: input.photoId, checkId: input.checkId, takenBy: takenBy.userId, takenByName: takenBy.name, takenAt, file }, now);
    return this.refresh(id);
  }

  /** Danger zone: deletes every photo file on the NAS. */
  wipePhotos(): Promise<void> {
    return this.photoFiles.removeAll();
  }

  async photoImage(photoId: string): Promise<Buffer> {
    const p = await this.store.signoffs.getPhoto(photoId);
    if (!p) throw notFound("Photo");
    try {
      return await this.photoFiles.read(p.file);
    } catch {
      throw notFound("Photo file");
    }
  }

  /** An operator may take back their own photos (until the sign-off is complete); anyone else's
   * only an admin. The file stays on the NAS; only the record is (soft-)deleted. */
  async removePhoto(id: string, photoId: string, actor: Actor): Promise<Signoff> {
    const s = await this.requireWritable(id, actor);
    const photo = s.photos.find((p) => p.id === photoId);
    if (!photo) return s;
    if (actor.role !== "admin") {
      if (photo.takenBy !== actor.userId) throw forbidden(`This photo was taken by ${photo.takenByName} — only they or an admin can remove it.`);
      this.assertEditable(s, actor);
    }
    await this.store.signoffs.removePhoto(id, photoId, new Date().toISOString());
    return this.refresh(id);
  }

  async removePart(id: string, partRowId: string, actor: Actor): Promise<Signoff> {
    this.assertEditable(await this.requireWritable(id, actor), actor);
    await this.store.signoffs.removePart(id, partRowId, new Date().toISOString());
    return this.refresh(id);
  }
}
