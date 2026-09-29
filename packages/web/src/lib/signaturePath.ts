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
