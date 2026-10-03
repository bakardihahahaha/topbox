import { EventEmitter } from "node:events";

// One process-wide bus: every successful write broadcasts "change", every open screen on every
// device listens on /api/events (SSE) and refetches — no polling.
export const dataChangeEmitter = new EventEmitter();
dataChangeEmitter.setMaxListeners(0);

/** "ended" (token): that session was signed out from elsewhere (e.g. the same person signed in
 * on another device) — its live-events stream tells the device straight away. */
export const sessionEndedEmitter = new EventEmitter();
sessionEndedEmitter.setMaxListeners(0);

export function broadcastDataChange(): void {
  dataChangeEmitter.emit("change");
}
