import { DEFAULT_DOCUMENT_SETTINGS, type DocumentSettings, type Signoff } from "@biosite-signoff/shared";
import { getDocumentSettings } from "./api.js";
import type { PdfBranding, PdfPhotos } from "./pdf.js";
import { photoForPdf } from "./photos.js";
import { showPdfViewer } from "./pdfViewerStore.js";

// jsPDF is ~400 KB — loaded only the first time someone actually generates a PDF. The company
// header (Setup → Document) is fetched fresh each time and remembered on the device, so a PDF
// made offline still carries the right address.
const KEY = "biosite-signoff.document-settings";

export function rememberDocumentSettings(settings: DocumentSettings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    // best-effort
  }
}

async function branding(override?: DocumentSettings): Promise<PdfBranding> {
  let settings = override;
  if (!settings) {
    try {
      settings = await getDocumentSettings();
      localStorage.setItem(KEY, JSON.stringify(settings));
    } catch {
      try {
        settings = JSON.parse(localStorage.getItem(KEY) ?? "null") ?? undefined;
      } catch {
        settings = undefined;
      }
    }
  }
  settings = { ...DEFAULT_DOCUMENT_SETTINGS, ...settings };
  if (!settings.logoDataUrl) return { settings };
  const img = new Image();
  img.src = settings.logoDataUrl;
  try {
    await img.decode();
    return { settings, logo: { dataUrl: settings.logoDataUrl, width: img.naturalWidth, height: img.naturalHeight } };
  } catch {
    return { settings };
  }
}

/** Every photo of these sign-offs, for the attachment pages (ones this device can't reach are
 * left out rather than failing the whole PDF). */
async function loadPhotos(signoffs: Signoff[]): Promise<PdfPhotos> {
  const ids = signoffs.flatMap((s) => (s.photos ?? []).map((p) => p.id));
  const loaded = await Promise.all(ids.map(async (id) => [id, await photoForPdf(id)] as const));
  return new Map(loaded.filter((e): e is [string, NonNullable<(typeof e)[1]>] => e[1] !== null));
}

export async function downloadPdf(signoffs: Signoff[]): Promise<void> {
  const [pdf, b, photos] = await Promise.all([import("./pdf.js"), branding(), loadPhotos(signoffs)]);
  pdf.downloadSignoffsPdf(signoffs, b, photos);
}

/** Shows the PDF on this page (in-app viewer: Save, Print, ✕ back to where you were).
 * `signoffs` may be a loader, for lists that fetch the full records first. `settings` lets
 * Setup → Document preview unsaved changes. */
export function viewPdf(signoffs: Signoff[] | (() => Promise<Signoff[]>), settings?: DocumentSettings): void {
  showPdfViewer(async () => {
    const list = typeof signoffs === "function" ? await signoffs() : signoffs;
    const [pdf, b, photos] = await Promise.all([import("./pdf.js"), branding(settings), loadPhotos(list)]);
    return { blob: pdf.signoffsPdfBlob(list, b, photos), fileName: pdf.pdfFileName(list) };
  });
}
