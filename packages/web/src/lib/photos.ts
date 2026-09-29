import { authedFetch } from "./client.js";

// Photos taken during a check. The camera image is shrunk on the device (longest side 1600 px,
// JPEG) before it's queued, so an upload is a few hundred KB even over a weak signal. Every photo
// this device has taken or viewed is kept in its Cache Storage, so it still shows (and still goes
// into a PDF) without a connection.
const CACHE = "topbox-photos";
const MAX_SIDE = 1600;

const memory = new Map<string, string>(); // photo id -> object URL (this page load)

const cacheKey = (id: string) => `/api/photos/${id}`;

async function openCache(): Promise<Cache | null> {
  try {
    return "caches" in window ? await caches.open(CACHE) : null;
  } catch {
    return null;
  }
}

/** Camera/file image → resized JPEG data URL. */
export async function toJpegDataUrl(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.toDataURL("image/jpeg", 0.8);
}

/** Keeps a just-taken photo on this device right away (before it has synced). */
export async function rememberPhoto(id: string, dataUrl: string): Promise<void> {
  const blob = await (await fetch(dataUrl)).blob();
  memory.set(id, URL.createObjectURL(blob));
  const cache = await openCache();
  await cache?.put(cacheKey(id), new Response(blob, { headers: { "content-type": "image/jpeg" } })).catch(() => {});
}

async function photoBlob(id: string): Promise<Blob> {
  const cache = await openCache();
  const hit = await cache?.match(cacheKey(id)).catch(() => undefined);
  if (hit) return hit.blob();
  const res = await authedFetch(cacheKey(id));
  const blob = await res.blob();
  await cache?.put(cacheKey(id), new Response(blob, { headers: { "content-type": "image/jpeg" } })).catch(() => {});
  return blob;
}

/** Object URL for an <img>. */
export async function photoUrl(id: string): Promise<string> {
  const known = memory.get(id);
  if (known) return known;
  const url = URL.createObjectURL(await photoBlob(id));
  memory.set(id, url);
  return url;
}

/** Data URL + pixel size — what jsPDF needs. */
export async function photoForPdf(id: string): Promise<{ dataUrl: string; width: number; height: number } | null> {
  try {
    const blob = await photoBlob(id);
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = () => reject(r.error);
      r.readAsDataURL(blob);
    });
    const img = new Image();
    img.src = dataUrl;
    await img.decode();
    return { dataUrl, width: img.naturalWidth, height: img.naturalHeight };
  } catch {
    return null;
  }
}
