import { EventEmitter } from "node:events";

// One process-wide bus: every successful write broadcasts "change", every open screen on every
// device listens on /api/events (SSE) and refetches — no polling.
export const dataChangeEmitter = new EventEmitter();
dataChangeEmitter.setMaxListeners(0);

export function broadcastDataChange(): void {
  dataChangeEmitter.emit("change");
}
