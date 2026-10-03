// pdf.js (legacy build — works on older iPad Safari too), loaded only when the viewer opens.
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import workerUrl from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

/** Draws every page of the PDF into `container` at `zoom` (1 = the page's real size on screen,
 * 96 dpi), sharp on retina. */
export async function renderPdfPages(blob: Blob, container: HTMLElement, isCancelled: () => boolean, zoom = 0.75): Promise<number> {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) }).promise;
  const ratio = Math.min(3, Math.max(1, window.devicePixelRatio || 1));
  for (let n = 1; n <= doc.numPages; n++) {
    if (isCancelled()) break;
    const page = await doc.getPage(n);
    const cssWidth = Math.round(page.getViewport({ scale: 1 }).width * (96 / 72) * zoom);
    const viewport = page.getViewport({ scale: (cssWidth / page.getViewport({ scale: 1 }).width) * ratio });
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    canvas.style.width = `${cssWidth}px`;
    canvas.style.height = `${Math.round(viewport.height / ratio)}px`;
    canvas.style.display = "block";
    canvas.style.margin = "0 auto 12px";
    canvas.style.background = "#fff";
    canvas.style.boxShadow = "0 2px 12px rgba(0,0,0,.35)";
    container.appendChild(canvas);
    await page.render({ canvasContext: canvas.getContext("2d")!, viewport }).promise;
  }
  const pages = doc.numPages;
  await doc.destroy();
  return pages;
}
