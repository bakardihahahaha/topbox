import { useSyncExternalStore } from "react";

// A drop-in, app-styled replacement for window.confirm/window.alert — a native browser dialog
// looks like an OS/Android system prompt, jarringly inconsistent with the rest of this app's own
// design. Modeled on savingStatus.ts's own external-store pattern: one shared "current request"
// (there's only ever one at a time — nothing here fires two confirmations concurrently), a single
// <ConfirmHost/> rendered once near the app root renders whatever's pending, and callers just
// await a promise exactly like they would have awaited nothing before with the native calls.

export interface ConfirmRequest {
  kind: "confirm" | "alert";
  message: string;
  title?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  resolve: (value: boolean) => void;
}

let current: ConfirmRequest | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  listeners.forEach((l) => l());
}

export function subscribeConfirmRequest(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getConfirmRequest(): ConfirmRequest | null {
  return current;
}

export function useConfirmRequest(): ConfirmRequest | null {
  return useSyncExternalStore(subscribeConfirmRequest, getConfirmRequest);
}

export interface ConfirmOptions {
  title?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Renders the confirm button in the app's danger color — for an action that removes or
   * overwrites something (matches the styling a native confirm() gave no way to convey at all). */
  danger?: boolean;
}

/** Resolves true (OK/Confirm) or false (Cancel/dismissed) — same shape as `if (!window.confirm(...))
 * return;` used to be, just `await`ed instead of blocking synchronously. */
export function confirmDialog(message: string, opts: ConfirmOptions = {}): Promise<boolean> {
  return new Promise((resolve) => {
    current = { kind: "confirm", message, resolve, ...opts };
    emit();
  });
}

/** Resolves once dismissed — same shape as `window.alert(...)` used to be, just awaited. */
export function alertDialog(message: string, opts: { title?: string } = {}): Promise<void> {
  return new Promise((resolve) => {
    current = { kind: "alert", message, resolve: () => resolve(), ...opts };
    emit();
  });
}

export function resolveConfirmRequest(value: boolean): void {
  const req = current;
  if (!req) return;
  current = null;
  emit();
  req.resolve(value);
}
