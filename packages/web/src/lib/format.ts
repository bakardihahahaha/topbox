/** "2026-09-29 14:05" (or "2026-09-29") -> "29/09/2026 14:05". */
export function stamp(s: string | null | undefined): string {
  if (!s) return "—";
  const [d, t] = s.split(" ");
  return `${d!.split("-").reverse().join("/")}${t ? ` ${t}` : ""}`;
}

/** ISO -> local "29/09/2026 14:05". */
export function localStamp(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** The TopBox page: /signoff/<serial number>, optionally opened on one visit. */
export function topboxUrl(serial: string, signoffId?: string): string {
  return `/signoff/${encodeURIComponent(serial)}${signoffId ? `?id=${signoffId}` : ""}`;
}
