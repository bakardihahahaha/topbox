import { jsPDF } from "jspdf";
import autoTable, { type CellHookData } from "jspdf-autotable";
import { DEFAULT_DOCUMENT_SETTINGS, SIGNATURE_BOX, departedAt, typeNameOf, type DocumentSettings, type Signoff } from "@biosite-signoff/shared";
import { parseSignaturePath } from "./signaturePath.js";
import { localStamp } from "./format.js";

// The PDF is built entirely in the browser (jsPDF) on whatever device presses the button — the
// NAS never renders anything, it only serves JSON. Layout follows the paper PA-DOC-189 form: the
// Biosite masthead, document reference, a bordered checklist table per sign-off, and several
// sign-offs stacked per A4 page (two of the standard mechanism checklist fit on one), each
// separated by a hairline — exactly like the printed original.

/** Company header/footer (Setup → Document) plus the uploaded logo's pixel size, if any. */
export interface PdfBranding {
  settings: DocumentSettings;
  logo?: { dataUrl: string; width: number; height: number };
}

export interface PdfImage {
  dataUrl: string;
  width: number;
  height: number;
}

/** Photo id → image, loaded by the caller (from the NAS or this device's cache). */
export type PdfPhotos = Map<string, PdfImage>;

/** The attachment after a sign-off's form: every photo, two per row, each captioned with the
 * check it was taken during. Returns false when there's nothing to print. */
function drawPhotos(doc: jsPDF, s: Signoff, photos: PdfPhotos): boolean {
  const list = (s.photos ?? []).filter((p) => photos.has(p.id));
  if (list.length === 0) return false;
  const colW = (PAGE.w - PAGE.margin * 2 - 6) / 2;
  const imgH = 78;
  const cellH = imgH + 12;
  let y = 0;
  let col = 0;
  const heading = (cont: boolean) => {
    doc.addPage();
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.setTextColor(...INK);
    doc.text(pdfText(`Photos - TopBox ${s.serialNumber}${cont ? " (continued)" : ""}`), PAGE.margin, PAGE.top + 2);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(...GREY);
    doc.text(pdfText(`${typeNameOf(s)} - attachment to the checklist above`), PAGE.margin, PAGE.top + 7);
    y = PAGE.top + 12;
    col = 0;
  };
  heading(false);
  list.forEach((p, i) => {
    if (col === 0 && i > 0 && y + cellH > PAGE.h - PAGE.bottom) heading(true);
    const img = photos.get(p.id)!;
    const x = PAGE.margin + col * (colW + 6);
    const scale = Math.min(colW / img.width, imgH / img.height);
    const w = img.width * scale;
    const h = img.height * scale;
    doc.addImage(img.dataUrl, "JPEG", x + (colW - w) / 2, y + (imgH - h) / 2, w, h);
    doc.setDrawColor(...GREY);
    doc.setLineWidth(0.2);
    doc.rect(x, y, colW, imgH);
    const check = s.template.checks.find((c) => c.id === p.checkId)?.label ?? "check";
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(...INK);
    doc.text(pdfText(`Taken during ${check}`), x, y + imgH + 4);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...GREY);
    doc.text(pdfText(`${localStamp(p.takenAt)} - ${p.takenByName}`), x, y + imgH + 8);
    col = 1 - col;
    if (col === 0) y += cellH;
  });
  return true;
}

const PAGE = { w: 210, h: 297, margin: 14, top: 34, bottom: 24 };
const INK: [number, number, number] = [16, 18, 21];
const GREY: [number, number, number] = [110, 116, 122];
const RED: [number, number, number] = [200, 40, 40];

/** jsPDF's built-in Helvetica only covers Latin-1 — fold anything else (ł, ś, ą, “ ”) to its
 * closest plain letter rather than printing garbage. */
function pdfText(s: string): string {
  return s
    .replace(/[łŁ]/g, (c) => (c === "ł" ? "l" : "L"))
    .replace(/[“”„]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[–—]/g, "-")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\x20-\x7E\xA0-\xFF\n]/g, "");
}

function drawMasthead(doc: jsPDF, documentRef: string, b: PdfBranding) {
  const c = b.settings;
  if (b.logo) {
    // Fit inside 60 x 14 mm, keeping the aspect ratio.
    const scale = Math.min(60 / b.logo.width, 14 / b.logo.height);
    const w = b.logo.width * scale;
    const h = b.logo.height * scale;
    doc.addImage(b.logo.dataUrl, b.logo.dataUrl.startsWith("data:image/png") ? "PNG" : "JPEG", PAGE.margin, 24 - h, w, h);
  } else {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(22);
    doc.setTextColor(0, 0, 0);
    if (c.logoText.trim()) doc.text(pdfText(c.logoText.trim()), PAGE.margin, 22, { maxWidth: 90 });
  }

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...INK);
  if (documentRef) doc.text(pdfText(documentRef), PAGE.w / 2 + 8, 26, { align: "center" });

  doc.setFontSize(7);
  const lines = [c.companyName, ...c.address.split("\n")].map((l) => pdfText(l.trim())).filter(Boolean).slice(0, 7);
  lines.forEach((l, i) => doc.text(l, PAGE.w - PAGE.margin, 8 + i * 3.1, { align: "right" }));
  doc.setDrawColor(...GREY);
  doc.setLineWidth(0.2);
  doc.line(PAGE.margin, 29, PAGE.w - PAGE.margin, 29);
}

function drawFooter(doc: jsPDF, documentId: string, page: number, pages: number, c: DocumentSettings) {
  const y = PAGE.h - 16;
  doc.setDrawColor(...GREY);
  doc.setLineWidth(0.2);
  doc.line(PAGE.margin, y - 4, PAGE.w - PAGE.margin, y - 4);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...INK);
  if (documentId) doc.text(pdfText(`${c.documentIdLabel} ${documentId}`.trim()), PAGE.margin, y);
  doc.text(`Page ${page} of ${pages}`, PAGE.w - PAGE.margin, y, { align: "right" });
  doc.setFontSize(8);
  if (c.footerText) doc.text(pdfText(c.footerText), PAGE.w / 2, y + 6, { align: "center", maxWidth: PAGE.w - PAGE.margin * 2 });
}

function drawTick(doc: jsPDF, cx: number, cy: number) {
  doc.setDrawColor(...INK);
  doc.setLineWidth(0.45);
  doc.line(cx - 1.6, cy, cx - 0.4, cy + 1.3);
  doc.line(cx - 0.4, cy + 1.3, cx + 1.9, cy - 1.5);
}

function drawCross(doc: jsPDF, cx: number, cy: number) {
  doc.setDrawColor(...RED);
  doc.setLineWidth(0.45);
  doc.line(cx - 1.4, cy - 1.4, cx + 1.4, cy + 1.4);
  doc.line(cx - 1.4, cy + 1.4, cx + 1.4, cy - 1.4);
}

function drawSignature(doc: jsPDF, path: string, x: number, y: number, w: number, h: number) {
  const scale = Math.min(w / SIGNATURE_BOX.width, h / SIGNATURE_BOX.height);
  const ox = x + (w - SIGNATURE_BOX.width * scale) / 2;
  doc.setDrawColor(20, 30, 90);
  doc.setLineWidth(0.3);
  for (const stroke of parseSignaturePath(path)) {
    for (let i = 1; i < stroke.length; i++) {
      doc.line(ox + stroke[i - 1]!.x * scale, y + stroke[i - 1]!.y * scale, ox + stroke[i]!.x * scale, y + stroke[i]!.y * scale);
    }
  }
}

/** Rough block height (mm) so a sign-off that won't fit starts on a fresh page instead of
 * splitting its table across two. */
/** Check columns share what the item text leaves (about 100mm of A4): 24mm each for 1-3 checks,
 * narrower from there, down to ~8mm for 12. */
const checkColWidth = (checks: number) => Math.min(24, 100 / Math.max(checks, 1));

function estimateHeight(s: Signoff): number {
  const itemWidth = PAGE.w - PAGE.margin * 2 - s.template.checks.length * checkColWidth(s.template.checks.length) - 3;
  const charsPerLine = itemWidth / 1.45;
  const lines = s.template.rows.reduce((n, r) => n + Math.max(1, Math.ceil(r.text.length / charsPerLine)), 0);
  let h = 7 + 9 + 4.6 + lines * 4.4 + (s.template.signRowEnabled ? 13 : 0) + 4.5;
  if (s.mode === "service" && s.parts.length) h += 6 + (s.parts.length + 1) * 4.6;
  if (s.notes.trim()) h += 4 + Math.ceil(s.notes.length / 120) * 3.6;
  return h;
}

type Cell = { content: string; styles?: Record<string, unknown>; colSpan?: number; kind?: string; value?: string; checkId?: string };

function drawSignoff(doc: jsPDF, s: Signoff, startY: number): number {
  const t = s.template;
  const checkW = checkColWidth(t.checks.length);
  const width = PAGE.w - PAGE.margin * 2;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  doc.setTextColor(...INK);
  doc.text(pdfText(t.name), PAGE.w / 2, startY + 3.5, { align: "center" });

  const markOf = (rowId: string, checkId: string) => s.marks.find((m) => m.rowId === rowId && m.checkId === checkId)?.value;
  const body: Cell[][] = [];
  body.push([
    { content: pdfText(t.serialLabel), styles: { fontStyle: "bold", fontSize: 10, minCellHeight: 9, valign: "middle" } },
    { content: pdfText(s.serialNumber), colSpan: t.checks.length, styles: { fontSize: 11, valign: "middle", halign: "center" } },
  ]);
  body.push([
    { content: pdfText(t.itemLabel || "Item"), styles: { fontStyle: "bold" } },
    ...t.checks.map((c) => ({ content: pdfText(c.label), styles: { fontStyle: "bold", fontSize: t.checks.length > 6 ? 6 : t.checks.length > 4 ? 7 : 8, halign: "center" } })),
  ]);
  for (const r of t.rows) {
    const label = { content: `${r.indent ? "  " : ""}${pdfText(r.text)}`, styles: { fontStyle: r.bold ? "bold" : "normal" } };
    if (r.kind === "section") {
      body.push([label, ...t.checks.map(() => ({ content: "- - - - - - - - - -", styles: { halign: "center", textColor: GREY, fontSize: 7 } }))]);
    } else {
      body.push([label, ...t.checks.map((c) => ({ content: markOf(r.id, c.id) === "na" ? "N/A" : "", kind: "mark", value: markOf(r.id, c.id), styles: { halign: "center" } }))]);
    }
  }
  if (t.signRowEnabled) {
    body.push([
      { content: pdfText(t.signRowLabel), styles: { minCellHeight: 13, valign: "bottom" } },
      ...t.checks.map((c) => ({ content: "", kind: "sign", checkId: c.id })),
    ]);
  }

  autoTable(doc, {
    startY: startY + 5.5,
    margin: { left: PAGE.margin, right: PAGE.margin, top: PAGE.top, bottom: PAGE.bottom },
    tableWidth: width,
    theme: "grid",
    body: body as never,
    styles: { font: "helvetica", fontSize: 8, textColor: INK, lineColor: [60, 60, 60], lineWidth: 0.15, cellPadding: { top: 0.6, bottom: 0.6, left: 1.5, right: 1.5 }, overflow: "linebreak" },
    columnStyles: Object.fromEntries(t.checks.map((_, i) => [i + 1, { cellWidth: checkW }])),
    rowPageBreak: "avoid",
    didDrawCell: (data: CellHookData) => {
      if (data.section !== "body") return;
      const raw = data.cell.raw as Cell;
      const { x, y, width: w, height: h } = data.cell;
      if (raw?.kind === "mark") {
        if (raw.value === "pass") drawTick(doc, x + w / 2, y + h / 2);
        if (raw.value === "fail") drawCross(doc, x + w / 2, y + h / 2);
      }
      if (raw?.kind === "sign") {
        const sig = s.signatures.find((g) => g.checkId === raw.checkId);
        if (!sig) return;
        drawSignature(doc, sig.path, x + 0.8, y + 0.4, w - 1.6, h - 6.4);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(5.5);
        doc.setTextColor(...INK);
        const fit = (text: string) => {
          let t = text;
          while (t.length > 3 && doc.getTextWidth(t) > w - 1.5) t = t.slice(0, -1);
          return t === text ? t : `${t.slice(0, -1)}.`;
        };
        doc.text(`${sig.date.split("-").reverse().join("/")}${sig.time ? ` ${sig.time}` : ""}`, x + w / 2, y + h - 3.6, { align: "center" });
        doc.text(fit(pdfText(sig.name)), x + w / 2, y + h - 1.1, { align: "center" });
      }
    },
  });

  let y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 3;

  doc.setFontSize(7);
  doc.setTextColor(...GREY);
  doc.setFont("helvetica", "normal");
  const left = departedAt(s);
  const leftText = left ? `  ·  left ${left.slice(0, 10).split("-").reverse().join("/")}${left.slice(10)}` : "";
  doc.text(pdfText(`${typeNameOf(s)}${leftText}  ·  started by ${s.createdByName}`), PAGE.margin, y + 1);
  y += 3;

  if (s.mode === "service" && s.parts.length > 0) {
    autoTable(doc, {
      startY: y + 1,
      margin: { left: PAGE.margin, right: PAGE.margin, top: PAGE.top, bottom: PAGE.bottom },
      theme: "grid",
      head: [["Parts replaced — Part No.", "Name", "Qty", "Note"]],
      body: s.parts.map((p) => [pdfText(p.partNumber), pdfText(p.name), String(p.qty), pdfText(p.note)]),
      styles: { font: "helvetica", fontSize: 8, textColor: INK, lineColor: [60, 60, 60], lineWidth: 0.15, cellPadding: 1 },
      headStyles: { fillColor: [240, 240, 240], textColor: INK, fontStyle: "bold" },
      columnStyles: { 0: { cellWidth: 48 }, 2: { cellWidth: 12, halign: "center" } },
    });
    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 2;
  }

  if (s.notes.trim()) {
    doc.setFontSize(8);
    doc.setTextColor(...INK);
    const lines = doc.splitTextToSize(pdfText(`Notes: ${s.notes.trim()}`), width) as string[];
    doc.text(lines, PAGE.margin, y + 3);
    y += 3 + lines.length * 3.6;
  }
  return y;
}

export function buildSignoffsPdf(signoffs: Signoff[], branding: PdfBranding = { settings: DEFAULT_DOCUMENT_SETTINGS }, photos: PdfPhotos = new Map()): jsPDF {
  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
  // Each page's masthead/footer belongs to the first sign-off drawn on it.
  const pageDocs: { ref: string; id: string }[] = [];
  let y = PAGE.top;
  signoffs.forEach((s, i) => {
    const h = estimateHeight(s);
    if (i > 0) {
      if (y + 8 + h > PAGE.h - PAGE.bottom) {
        doc.addPage();
        y = PAGE.top;
      } else {
        doc.setDrawColor(200, 200, 200);
        doc.setLineWidth(0.3);
        doc.line(0, y + 3, PAGE.w, y + 3);
        y += 8;
      }
    }
    const page = doc.getNumberOfPages();
    if (!pageDocs[page - 1]) pageDocs[page - 1] = { ref: s.template.documentRef, id: s.template.documentId };
    y = drawSignoff(doc, s, y);
    // Its photos follow on their own page(s); the next sign-off then starts on a fresh page.
    if (drawPhotos(doc, s, photos)) {
      const last = doc.getNumberOfPages();
      for (let p = page + 1; p <= last; p++) pageDocs[p - 1] = { ref: s.template.documentRef, id: s.template.documentId };
      y = PAGE.h;
    }
  });

  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    const meta = pageDocs[p - 1] ?? pageDocs.filter(Boolean).at(-1) ?? { ref: "", id: "" };
    drawMasthead(doc, meta.ref, branding);
    drawFooter(doc, meta.id, p, pages, branding.settings);
  }
  return doc;
}

export function pdfFileName(signoffs: Signoff[]): string {
  if (signoffs.length === 1) {
    const s = signoffs[0]!;
    return `TopBox ${s.serialNumber} ${typeNameOf(s)} ${(departedAt(s) ?? s.createdAt).slice(0, 10)}.pdf`.replace(/[\\/:*?"<>|]+/g, "-");
  }
  return `Sign-offs ${new Date().toISOString().slice(0, 10)} (${signoffs.length}).pdf`;
}

/** Builds and downloads the PDF on this device. */
export function downloadSignoffsPdf(signoffs: Signoff[], branding: PdfBranding, photos?: PdfPhotos): void {
  buildSignoffsPdf(signoffs, branding, photos).save(pdfFileName(signoffs));
}

/** Blob URL of the PDF, for opening in a tab (handy on desktops for printing straight away). */
export function signoffsPdfUrl(signoffs: Signoff[], branding: PdfBranding, photos?: PdfPhotos): string {
  return String(buildSignoffsPdf(signoffs, branding, photos).output("bloburl"));
}
