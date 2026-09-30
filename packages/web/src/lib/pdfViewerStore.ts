import { useSyncExternalStore } from "react";

/** What the in-app PDF viewer is showing (one at a time) — see components/PdfViewerHost. */
export interface PdfViewerRequest {
  id: number;
  load: () => Promise<{ blob: Blob; fileName: string }>;
}

let current: PdfViewerRequest | null = null;
let seq = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function showPdfViewer(load: PdfViewerRequest["load"]): void {
  current = { id: ++seq, load };
  emit();
}

export function closePdfViewer(): void {
  current = null;
  emit();
}

export function usePdfViewerRequest(): PdfViewerRequest | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
  );
}
