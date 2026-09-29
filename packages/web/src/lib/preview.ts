import type { Signoff, Template } from "@biosite-signoff/shared";
import type { Me } from "./client.js";

/** An empty sign-off of `template` for "Preview PDF" buttons — nothing is saved. */
export function mechanismPreview(template: Template | undefined, me: Me, serialNumber = "SAMPLE-0001"): Signoff {
  const now = new Date().toISOString();
  const t: Template = template ?? {
    id: "preview",
    name: "Checklist",
    documentRef: "",
    documentId: "",
    serialLabel: "Serial Number",
    itemLabel: "Item",
    checks: [
      { id: "c1", label: "1st Check" },
      { id: "c2", label: "2nd Check" },
    ],
    rows: [{ id: "r1", kind: "item", text: "Example item", bold: false, indent: false }],
    signRowEnabled: true,
    signRowLabel: "Sign and date here",
    distinctSigners: false,
    partIds: [],
    createdAt: now,
    updatedAt: now,
  };
  return {
    id: "preview",
    number: "SO-PREVIEW",
    templateId: t.id,
    template: t,
    serialNumber,
    arrivedAt: now,
    mode: "new",
    typeId: "",
    typeName: "New",
    notes: "",
    marks: [],
    signatures: [],
    parts: [],
    createdBy: me.userId,
    createdByName: me.name,
    createdAt: now,
    updatedAt: now,
  };
}
