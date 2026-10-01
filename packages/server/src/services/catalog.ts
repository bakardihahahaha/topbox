import { randomUUID } from "node:crypto";
import type { Part, PartInput, Template, TemplateInput } from "@biosite-signoff/shared";
import type { Store } from "../store/Store.js";
import { badRequest, conflict, notFound } from "./errors.js";

/** Admin-defined reference data: replaceable parts and checklist templates. */
export class CatalogService {
  constructor(private readonly store: Store) {}

  // ---- parts ---------------------------------------------------------------------------------

  listParts(): Promise<Part[]> {
    return this.store.parts.list();
  }

  private async assertUniquePartNumber(partNumber: string, exceptId?: string) {
    const clash = (await this.store.parts.list()).find((p) => p.partNumber.toLowerCase() === partNumber.toLowerCase() && p.id !== exceptId);
    if (clash) throw conflict("PART_NUMBER_TAKEN", `Part number "${partNumber}" already exists (${clash.name}).`);
  }

  async createPart(input: PartInput, id?: string): Promise<Part> {
    const partNumber = input.partNumber.trim();
    const name = input.name.trim();
    if (!partNumber || !name) throw badRequest("Part number and name are required.");
    if (id) {
      const existing = await this.store.parts.get(id);
      if (existing) return existing; // idempotent retry
    }
    await this.assertUniquePartNumber(partNumber);
    const now = new Date().toISOString();
    const part: Part = { id: id ?? randomUUID(), partNumber, name, description: input.description.trim(), createdAt: now, updatedAt: now };
    await this.store.parts.create(part);
    return part;
  }

  async updatePart(id: string, patch: Partial<PartInput>): Promise<Part> {
    if (!(await this.store.parts.get(id))) throw notFound("Part");
    if (patch.partNumber !== undefined) {
      if (!patch.partNumber.trim()) throw badRequest("Part number is required.");
      await this.assertUniquePartNumber(patch.partNumber.trim(), id);
    }
    if (patch.name !== undefined && !patch.name.trim()) throw badRequest("Name is required.");
    await this.store.parts.update(id, { partNumber: patch.partNumber?.trim(), name: patch.name?.trim(), description: patch.description?.trim() });
    return (await this.store.parts.get(id))!;
  }

  /** The admin's order of the parts — the order sign-offs list them in. Must name every part once. */
  async reorderParts(ids: string[]): Promise<Part[]> {
    const current = await this.store.parts.list();
    const known = new Set(current.map((p) => p.id));
    if (ids.length !== known.size || new Set(ids).size !== ids.length || ids.some((i) => !known.has(i))) {
      throw conflict("PARTS_CHANGED", "The parts list changed meanwhile — reload the page and try again.");
    }
    await this.store.parts.reorder(ids, new Date().toISOString());
    return this.store.parts.list();
  }

  /** Soft delete — sign-offs that already recorded this part keep their own snapshot of it; it
   * just can't be picked any more. Also dropped from every template's allowed list. */
  async deletePart(id: string): Promise<void> {
    if (!(await this.store.parts.get(id))) return;
    const now = new Date().toISOString();
    await this.store.parts.softDelete(id, now);
    for (const t of await this.store.templates.list()) {
      if (t.partIds.includes(id)) await this.store.templates.replace({ ...t, partIds: t.partIds.filter((p) => p !== id), updatedAt: now });
    }
  }

  // ---- templates -----------------------------------------------------------------------------

  listTemplates(): Promise<Template[]> {
    return this.store.templates.list();
  }

  async getTemplate(id: string): Promise<Template> {
    const t = await this.store.templates.get(id);
    if (!t) throw notFound("Template");
    return t;
  }

  private async validate(input: TemplateInput): Promise<TemplateInput> {
    const name = input.name.trim();
    if (!name) throw badRequest("Template name is required.");
    if (input.checks.length === 0) throw badRequest("A template needs at least one check column.");
    if (input.checks.length > 12) throw badRequest("At most 12 check columns (more won't fit on an A4 page).");
    if (input.checks.some((c) => !c.label.trim())) throw badRequest("Every check column needs a label.");
    if (input.rows.filter((r) => r.kind === "item").length === 0) throw badRequest("A template needs at least one item.");
    if (input.rows.some((r) => !r.text.trim())) throw badRequest("Every row needs text.");
    const ids = [...input.checks.map((c) => c.id), ...input.rows.map((r) => r.id)];
    if (ids.some((i) => !i) || new Set(ids).size !== ids.length) throw badRequest("Row and check ids must be unique.");
    const knownParts = new Set((await this.store.parts.list()).map((p) => p.id));
    const unknown = input.partIds.filter((p) => !knownParts.has(p));
    if (unknown.length) throw badRequest("Some selected parts no longer exist — reload and try again.");
    return {
      ...input,
      name,
      documentRef: input.documentRef.trim(),
      documentId: input.documentId.trim(),
      serialLabel: input.serialLabel.trim() || "Serial Number",
      itemLabel: input.itemLabel.trim() || "Item",
      signRowLabel: input.signRowLabel.trim() || "Sign and date here",
      checks: input.checks.map((c) => ({ id: c.id, label: c.label.trim() })),
      rows: input.rows.map((r) => ({ id: r.id, kind: r.kind, text: r.text.trim(), bold: Boolean(r.bold), indent: Boolean(r.indent) })),
      partIds: [...new Set(input.partIds)],
    };
  }

  async createTemplate(input: TemplateInput, id?: string): Promise<Template> {
    if (id) {
      const existing = await this.store.templates.get(id);
      if (existing) return existing;
    }
    const clean = await this.validate(input);
    const now = new Date().toISOString();
    const t: Template = { ...clean, id: id ?? randomUUID(), createdAt: now, updatedAt: now };
    await this.store.templates.create(t);
    return t;
  }

  /** Editing a template never touches existing sign-offs — each froze its own copy when started. */
  async updateTemplate(id: string, input: TemplateInput): Promise<Template> {
    const current = await this.getTemplate(id);
    const clean = await this.validate(input);
    const t: Template = { ...clean, id, createdAt: current.createdAt, updatedAt: new Date().toISOString() };
    await this.store.templates.replace(t);
    return t;
  }

  async duplicateTemplate(id: string): Promise<Template> {
    const src = await this.getTemplate(id);
    const { id: _id, createdAt: _c, updatedAt: _u, ...rest } = src;
    return this.createTemplate({ ...rest, name: `${src.name} (copy)` });
  }

  async deleteTemplate(id: string): Promise<void> {
    if (!(await this.store.templates.get(id))) return;
    await this.store.templates.softDelete(id, new Date().toISOString());
  }
}

/** The paper PA-DOC-189 mechanism checklist — seeded on a brand-new database so the app has a
 * real, working template from the first sign-in (and as an example of sections/indented rows). */
export function mechanismChecklistSeed(): TemplateInput {
  const item = (text: string, extra: Partial<{ bold: boolean; indent: boolean }> = {}) => ({ id: randomUUID(), kind: "item" as const, text, bold: false, indent: false, ...extra });
  return {
    name: "Mechanism Checklist",
    documentRef: "PA-DOC-189, revision 6, released 23-May-2019",
    documentId: "PA-DOC-189-006",
    serialLabel: "Serial Number",
    itemLabel: "Item",
    checks: [
      { id: randomUUID(), label: "1st Check" },
      { id: randomUUID(), label: "2nd Check" },
    ],
    rows: [
      item("Earth bond connected"),
      item("Circlips present (cam wheel, 2 x locking arms, 4 x plunger block)"),
      item("Locking arms fit under cam wheel (with 2mm clearance)"),
      item("Plungers greased (do not grease the spring or the plunger directly under the spring)"),
      item('Damper set no less than "2"'),
      item("Main bearing grub screws secured"),
      item("Six bolts on cam wheel tight"),
      item("Rubber supports correct"),
      item("Green pair on the right"),
      item("Sensor board coating good"),
      { id: randomUUID(), kind: "section", text: "Security red paint on:", bold: true, indent: false },
      item("Solenoid clevis fork joint", { bold: true, indent: true }),
      item("Solenoid screw thread", { bold: true, indent: true }),
      item("Solenoid screw head (underside)", { bold: true, indent: true }),
      item("Damper thread and nuts", { bold: true, indent: true }),
      item("Four bolts on the cover", { bold: true, indent: true }),
    ],
    signRowEnabled: true,
    signRowLabel: "Sign and date here",
    distinctSigners: false,
    partIds: [],
  };
}
