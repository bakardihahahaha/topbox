import { forwardRef, useImperativeHandle, useRef, useState } from "react";
import { SIGNATURE_BOX } from "@biosite-signoff/shared";

export interface SignaturePadHandle {
  clear: () => void;
}

/**
 * Captures a signature as vector strokes (not a PNG) in a fixed 300x100 coordinate box and hands
 * the caller an SVG path string — a few hundred bytes, crisp at any print size, and small enough
 * to live in one Google Sheets cell on the backup mirror. Same look as decom's SignaturePad.
 */
export const SignaturePad = forwardRef<SignaturePadHandle, { onChange: (path: string | null) => void }>(function SignaturePad({ onChange }, ref) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const strokes = useRef<{ x: number; y: number }[][]>([]);
  const drawing = useRef(false);
  const [hasDrawn, setHasDrawn] = useState(false);
  const { width: W, height: H } = SIGNATURE_BOX;

  function pos(e: React.PointerEvent<HTMLCanvasElement>) {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: Math.round(((e.clientX - rect.left) / rect.width) * W), y: Math.round(((e.clientY - rect.top) / rect.height) * H) };
  }

  function ctx() {
    const c = canvasRef.current!.getContext("2d")!;
    c.strokeStyle = "#1c1d2e";
    c.lineWidth = 2.2;
    c.lineCap = "round";
    c.lineJoin = "round";
    return c;
  }

  function toPath(): string {
    return strokes.current
      .filter((s) => s.length > 0)
      .map((s) => {
        const pts = s.length === 1 ? [s[0]!, { x: s[0]!.x + 1, y: s[0]!.y }] : s;
        return pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x} ${p.y}`).join("");
      })
      .join("");
  }

  useImperativeHandle(ref, () => ({
    clear() {
      strokes.current = [];
      canvasRef.current!.getContext("2d")!.clearRect(0, 0, W, H);
      setHasDrawn(false);
      onChange(null);
    },
  }));

  return (
    <div style={{ position: "relative", width: "100%", maxWidth: 420 }}>
      <canvas
        ref={canvasRef}
        width={W}
        height={H}
        onPointerDown={(e) => {
          canvasRef.current!.setPointerCapture(e.pointerId);
          const p = pos(e);
          strokes.current.push([p]);
          const c = ctx();
          c.beginPath();
          c.moveTo(p.x, p.y);
          drawing.current = true;
        }}
        onPointerMove={(e) => {
          if (!drawing.current) return;
          const p = pos(e);
          const stroke = strokes.current[strokes.current.length - 1]!;
          const last = stroke[stroke.length - 1]!;
          if (last.x === p.x && last.y === p.y) return;
          stroke.push(p);
          const c = ctx();
          c.lineTo(p.x, p.y);
          c.stroke();
          if (!hasDrawn) setHasDrawn(true);
        }}
        onPointerUp={() => {
          if (!drawing.current) return;
          drawing.current = false;
          setHasDrawn(true);
          onChange(toPath());
        }}
        style={{ width: "100%", aspectRatio: `${W} / ${H}`, background: "#fff", border: "1px solid var(--border)", borderRadius: "var(--radius-control)", touchAction: "none", display: "block" }}
      />
      {!hasDrawn && (
        <span style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: "#9aa", fontSize: 12, pointerEvents: "none" }}>Sign here</span>
      )}
    </div>
  );
});

/** Read-only rendering of a stored signature path. */
export function SignatureImage({ path, height = 34 }: { path: string; height?: number }) {
  const { width: W, height: H } = SIGNATURE_BOX;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ height, width: (height * W) / H, maxWidth: "100%", background: "#fff", borderRadius: "var(--radius-micro)", display: "block" }}>
      <path d={path} fill="none" stroke="#1c1d2e" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
