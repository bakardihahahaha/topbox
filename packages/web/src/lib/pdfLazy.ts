import { DEFAULT_DOCUMENT_SETTINGS, type DocumentSettings, type Signoff } from "@biosite-signoff/shared";
import { getDocumentSettings } from "./api.js";
import type { PdfBranding } from "./pdf.js";

// jsPDF is ~400 KB — loaded only the first time someone actually generates a PDF. The company
// header (Setup → Document) is fetched fresh each time and remembered on the device, so a PDF
// made offline still carries the right address.
const KEY = "biosite-signoff.document-settings";

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

export async function downloadPdf(signoffs: Signoff[]): Promise<void> {
  const [pdf, b] = await Promise.all([import("./pdf.js"), branding()]);
  pdf.downloadSignoffsPdf(signoffs, b);
}

/** `settings` lets Setup → Document preview unsaved changes. */
export async function openPdf(signoffs: Signoff[], settings?: DocumentSettings): Promise<void> {
  // The tab is opened synchronously, inside the click — opened after the awaits below, popup
  // blockers would swallow it.
  const tab = window.open("about:blank", "_blank");
  const [pdf, b] = await Promise.all([import("./pdf.js"), branding(settings)]);
  const url = pdf.signoffsPdfUrl(signoffs, b);
  if (tab) tab.location.href = url;
  else window.location.href = url;
}
