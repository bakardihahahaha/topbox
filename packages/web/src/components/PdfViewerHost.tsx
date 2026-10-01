import { useEffect, useRef, useState } from "react";
import { closePdfViewer, usePdfViewerRequest } from "../lib/pdfViewerStore.js";
import { errorMessage, ghost, primary } from "../lib/ui.js";
import { lazyImport } from "../lib/staleBundle.js";

/**
 * The in-app PDF viewer: the PDF's pages drawn right on this page, with Save (download), Print
 * and ✕ — which just closes it, back to the TopBox / list exactly where you were.
 */
export function PdfViewerHost() {
  const req = usePdfViewerRequest();
  const pagesRef = useRef<HTMLDivElement>(null);
  const [file, setFile] = useState<{ blob: Blob; fileName: string; url: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pages, setPages] = useState(0);

  useEffect(() => {
    if (!req) return;
    let cancelled = false;
    let url = "";
    setFile(null);
    setError(null);
    setPages(0);
    (async () => {
      try {
        const { blob, fileName } = await req.load();
        if (cancelled) return;
        url = URL.createObjectURL(blob);
        setFile({ blob, fileName, url });
        const { renderPdfPages } = await lazyImport(() => import("../lib/pdfRender.js"));
        const container = pagesRef.current;
        if (!container || cancelled) return;
        container.innerHTML = "";
        setPages(await renderPdfPages(blob, container, () => cancelled));
      } catch (err) {
        if (!cancelled) setError(errorMessage(err));
      }
    })();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && closePdfViewer();
    window.addEventListener("keydown", onKey);
    return () => {
      cancelled = true;
      window.removeEventListener("keydown", onKey);
      if (url) URL.revokeObjectURL(url);
    };
  }, [req]);

  if (!req) return null;

  function save() {
    if (!file) return;
    const a = document.createElement("a");
    a.href = file.url;
    a.download = file.fileName;
    a.click();
  }

  function print() {
    if (!file) return;
    // iPad / iPhone Safari can't print a PDF from inside the page — open it on its own there, then
    // use Share → Print.
    const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    if (ios) {
      window.open(file.url, "_blank");
      return;
    }
    const frame = document.createElement("iframe");
    frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0";
    frame.src = file.url;
    frame.onload = () => {
      try {
        frame.contentWindow?.focus();
        frame.contentWindow?.print();
      } catch {
        window.open(file.url, "_blank");
      }
      setTimeout(() => frame.remove(), 60_000);
    };
    document.body.appendChild(frame);
  }

  return (
    <div role="dialog" aria-modal="true" aria-label="PDF preview" style={{ position: "fixed", inset: 0, zIndex: 9500, background: "rgba(20,22,26,.96)", display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 12px", borderBottom: "1px solid var(--border-soft)", background: "var(--bg-base)", flexWrap: "wrap" }}>
        <div className="mono" style={{ flex: 1, minWidth: 0, fontSize: 13, color: "var(--text-2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {file ? file.fileName : "Preparing PDF…"}
          {pages > 0 && <span style={{ color: "var(--text-4)" }}> · {pages} page{pages === 1 ? "" : "s"}</span>}
        </div>
        <button style={{ ...primary, height: 52, minWidth: 110 }} onClick={save} disabled={!file}>
          Save
        </button>
        <button style={{ ...ghost, height: 52, minWidth: 110 }} onClick={print} disabled={!file}>
          Print
        </button>
        <button onClick={closePdfViewer} aria-label="Close" title="Close (back)" style={{ ...ghost, height: 52, width: 52, padding: 0, fontSize: 22 }}>
          ✕
        </button>
      </div>
      <div style={{ flex: 1, overflowY: "auto", padding: "16px 8px" }}>
        {error && <div style={{ color: "#f88", textAlign: "center", padding: 24 }}>{error}</div>}
        {!error && pages === 0 && <div style={{ color: "#aaa", textAlign: "center", padding: 24 }}>Loading…</div>}
        <div ref={pagesRef} />
      </div>
    </div>
  );
}
