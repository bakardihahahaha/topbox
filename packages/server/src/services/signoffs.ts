import { isCheckFullyMarked, itemRows, signoffProgress, signoffStatus, typeNameOf, type MarkValue, type Signoff, type SignoffMode, type SignoffSummary } from "@biosite-signoff/shared";
import type { SignoffTypesService } from "./signoffTypes.js";
import type { SignoffListFilter, Store } from "../store/Store.js";
import { badRequest, conflict, forbidden, notFound } from "./errors.js";

export interface Actor {
  userId: string;
  role: "admin" | "operator";
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
  ) {}

  private async require(id: string) {
    const s = await this.store.signoffs.get(id);
    if (!s) throw notFound("Sign-off");
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
    const { done, total } = signoffProgress(s);
    return {
      id: s.id,
      number: s.number,
      templateId: s.templateId,
      templateName: s.template.name,
      serialNumber: s.serialNumber,
      mode: s.mode,
      typeName: typeNameOf(s),
      status: signoffStatus(s),
      progress: `${done}/${total}`,
      createdByName: s.createdByName,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
    };
  }

  async list(filter: SignoffListFilter): Promise<{ items: SignoffSummary[]; total: number }> {
    const { items, total } = await this.store.signoffs.list(filter);
    return { items: items.map((s) => this.toSummary(s)), total };
  }

  get(id: string): Promise<Signoff> {
    return this.require(id);
  }

  /** `id` comes from the client so a queued/retried create is idempotent. */
  async create(input: { id: string; templateId: string; serialNumber: string; typeId?: string; mode?: SignoffMode }, actor: Actor): Promise<Signoff> {
    const existing = await this.store.signoffs.get(input.id);
    if (existing) return existing;
    const template = await this.store.templates.get(input.templateId);
    if (!template) throw notFound("Template");
    const serialNumber = input.serialNumber.trim();
    if (!serialNumber) throw badRequest("Serial number is required.");
    const type = await this.types.resolve(input);
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

  async updateHeader(id: string, patch: { serialNumber?: string; notes?: string; typeId?: string; mode?: SignoffMode }): Promise<Signoff> {
    const s = await this.require(id);
    if (patch.serialNumber !== undefined && !patch.serialNumber.trim()) throw badRequest("Serial number is required.");
    const type = patch.typeId !== undefined || patch.mode !== undefined ? await this.types.resolve(patch) : undefined;
    if (type?.mode === "new" && s.parts.length > 0) {
      throw conflict("HAS_PARTS", `Remove the replaced parts before switching this sign-off to ${type.typeName || "a check-only type"}.`);
    }
    await this.store.signoffs.updateHeader(id, { serialNumber: patch.serialNumber?.trim(), notes: patch.notes, ...type }, new Date().toISOString());
    return this.refresh(id);
  }

  async remove(id: string, actor: Actor): Promise<void> {
    const s = await this.store.signoffs.get(id);
    if (!s) return;
    if (actor.role !== "admin" && (s.createdBy !== actor.userId || s.signatures.length > 0)) {
      throw forbidden("Only an admin can delete a sign-off that someone else started or that already has signatures.");
    }
    await this.store.signoffs.softDelete(id, new Date().toISOString());
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
    const s = await this.require(id);
    this.assertCheck(s, input.checkId);
    if (!itemRows(s.template).some((r) => r.id === input.rowId)) throw badRequest("Unknown item row.");
    this.assertNotSigned(s, input.checkId);
    const at = new Date().toISOString();
    if (input.value === null) await this.store.signoffs.clearMark(id, input.rowId, input.checkId, at);
    else await this.store.signoffs.upsertMark(id, { rowId: input.rowId, checkId: input.checkId, value: input.value, byUserId: actor.userId, byName: actor.name, at });
    return this.refresh(id);
  }

  /** "Tick all" — marks every still-empty item in one check column (never overwrites a ✗). */
  async fillCheck(id: string, input: { checkId: string; value: MarkValue }, actor: Actor): Promise<Signoff> {
    const s = await this.require(id);
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

  async sign(id: string, input: { checkId: string; path: string; date: string }, actor: Actor): Promise<Signoff> {
    const s = await this.require(id);
    this.assertCheck(s, input.checkId);
    if (!s.template.signRowEnabled) throw badRequest("This template has no sign row.");
    if (!DATE_RE.test(input.date)) throw badRequest("Date must be YYYY-MM-DD.");
    if (!input.path || input.path.length > 40_000 || !PATH_RE.test(input.path)) throw badRequest("Invalid signature.");
    const existing = s.signatures.find((sig) => sig.checkId === input.checkId);
    // Re-sending the same user's signature (a retried request) just overwrites it; someone else's
    // signature is never silently replaced.
    if (existing && existing.userId !== actor.userId) throw conflict("ALREADY_SIGNED", `Already signed by ${existing.name}.`);
    if (!isCheckFullyMarked(s, input.checkId)) throw conflict("CHECK_INCOMPLETE", "Mark every item in this check before signing it.");
    if (s.template.distinctSigners && s.signatures.some((sig) => sig.checkId !== input.checkId && sig.userId === actor.userId)) {
      throw conflict("SAME_SIGNER", "You already signed another check on this sign-off — this one needs a different person.");
    }
    await this.store.signoffs.upsertSignature(id, { checkId: input.checkId, userId: actor.userId, name: actor.name, path: input.path, date: input.date, at: new Date().toISOString() });
    return this.refresh(id);
  }

  async unsign(id: string, checkId: string, actor: Actor): Promise<Signoff> {
    const s = await this.require(id);
    const existing = s.signatures.find((sig) => sig.checkId === checkId);
    if (!existing) return s;
    if (existing.userId !== actor.userId && actor.role !== "admin") throw forbidden("Only the person who signed (or an admin) can remove this signature.");
    await this.store.signoffs.clearSignature(id, checkId, new Date().toISOString());
    return this.refresh(id);
  }

  /** `partRowId` is client-generated, so a retried add lands on the same row. */
  async setPart(id: string, partRowId: string, input: { partId: string; qty: number; note: string }): Promise<Signoff> {
    const s = await this.require(id);
    if (s.mode !== "service") throw conflict("NOT_SERVICE", `Parts can't be recorded on a ${typeNameOf(s)} sign-off — only on a type that allows replaced parts.`);
    if (!s.template.partIds.includes(input.partId)) throw badRequest("This part isn't allowed for this template.");
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

  async removePart(id: string, partRowId: string): Promise<Signoff> {
    await this.require(id);
    await this.store.signoffs.removePart(id, partRowId, new Date().toISOString());
    return this.refresh(id);
  }
}
