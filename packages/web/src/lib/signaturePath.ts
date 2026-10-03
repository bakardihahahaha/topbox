/** Parses SignaturePad's "M x y L x y …" path into strokes (arrays of points) — used by the PDF
 * generator, which draws the lines itself. */
export function parseSignaturePath(path: string): { x: number; y: number }[][] {
  const strokes: { x: number; y: number }[][] = [];
  const re = /([ML])\s*(-?\d+(?:\.\d+)?)[\s,]+(-?\d+(?:\.\d+)?)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(path))) {
    const pt = { x: Number(m[2]), y: Number(m[3]) };
    if (m[1] === "M" || strokes.length === 0) strokes.push([pt]);
    else strokes[strokes.length - 1]!.push(pt);
  }
  return strokes;
}

/** The area the ink actually covers (in pad units), with `pad` around it — so a signature can be
 * blown up to fill its box instead of carrying the empty canvas around it. null = no ink. */
export function signatureBounds(path: string, pad = 0): { x: number; y: number; width: number; height: number } | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const stroke of parseSignaturePath(path)) {
    for (const p of stroke) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
  }
  if (!Number.isFinite(minX)) return null;
  // A perfectly straight stroke still needs some height / width to scale against.
  const width = Math.max(maxX - minX, 1);
  const height = Math.max(maxY - minY, 1);
  return { x: minX - pad, y: minY - pad, width: width + pad * 2, height: height + pad * 2 };
}
