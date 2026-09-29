import { getToken } from "./client.js";

// One shared SSE connection for the whole signed-in session — not one per screen. The server
// (routes/events.ts) fires a "change" event on every successful write from any device, so every
// open screen here can react to it instead of polling; a single long-lived connection per tab is
// the only added load on the server/NAS, matching the endpoint's own design intent.
type Listener = () => void;
const listeners = new Set<Listener>();
let source: EventSource | null = null;

export function connectLiveEvents(): void {
  if (source) return;
  const token = getToken();
  if (!token) return;
  source = new EventSource(`/api/events?token=${encodeURIComponent(token)}`);
  source.addEventListener("change", () => listeners.forEach((l) => l()));
}

export function disconnectLiveEvents(): void {
  source?.close();
  source = null;
}

/** Runs `listener` whenever any device's write lands on the server. Returns an unsubscribe
 * function — call it from a useEffect cleanup so a page stops reacting once it unmounts. */
export function onDataChange(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
