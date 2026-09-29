import type { Signoff } from "@biosite-signoff/shared";

// jsPDF is ~400 KB — loaded only the first time someone actually generates a PDF, not on every
// app start.
export async function downloadPdf(signoffs: Signoff[]): Promise<void> {
  (await import("./pdf.js")).downloadSignoffsPdf(signoffs);
}

export async function openPdf(signoffs: Signoff[]): Promise<void> {
  (await import("./pdf.js")).openSignoffsPdf(signoffs);
}
