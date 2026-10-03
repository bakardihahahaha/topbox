import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { SIGNATURE_BOX } from "@biosite-signoff/shared";
import { signatureBounds } from "../lib/signaturePath.js";

export interface SignaturePadHandle {
  clear: () => void;
}

/**
 * Captures a signature as vector strokes (not a PNG) in a fixed 300x100 coordinate box and hands
 * the caller an SVG path string — small, crisp at any print size, and small enough to live in one
 * Google Sheets cell on the backup mirror. Points keep one decimal (10x finer than whole units),
 * and the canvas is drawn at the screen's real resolution, so nothing looks pixelated while signing.
 */
// Google Sheets allows 50,000 characters per cell; the server accepts up to 40,000.
const MAX_PATH = 38_000;
// Ignore pointer moves shorter than this (in box units) — keeps the path small on fast devices.
const MIN_STEP = 1.2;

export const SignaturePad = forwardRef<SignaturePadHandle, { onChange: (path: string | null) => void }>(function SignaturePad({ onChange }, ref) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const strokes = useRef<{ x: number; y: number }[][]>([]);
  const drawing = useRef(false);
  const [hasDrawn, setHasDrawn] = useState(false);
  const { width: W, height: H } = SIGNATURE_BOX;
  const round1 = (v: number) => Math.round(v * 10) / 10;

  function pos(e: React.PointerEvent<HTMLCanvasElement>) {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: round1(((e.clientX - rect.left) / rect.width) * W), y: round1(((e.clientY - rect.top) / rect.height) * H) };
  }

  /** 2D context drawing in box units (300x100), whatever the canvas's real pixel size. */
  function ctx() {
    const canvas = canvasRef.current!;
    const c = canvas.getContext("2d")!;
    c.setTransform(canvas.width / W, 0, 0, canvas.height / H, 0, 0);
    c.strokeStyle = "#1c1d2e";
    c.lineWidth = 1.6;
    c.lineCap = "round";
    c.lineJoin = "round";
    return c;
  }

  function redraw() {
    const c = ctx();
    c.clearRect(0, 0, W, H);
    for (const s of strokes.current) {
      if (s.length === 0) continue;
      c.beginPath();
      c.moveTo(s[0]!.x, s[0]!.y);
      for (const p of s.length === 1 ? [{ x: s[0]!.x + 0.5, y: s[0]!.y }] : s.slice(1)) c.lineTo(p.x, p.y);
      c.stroke();
    }
  }

  // Match the canvas's pixels to its on-screen size × the screen's pixel ratio (sharp on iPad /
  // phone retina screens and at every Size setting), redrawing whatever is already signed.
  useEffect(() => {
    const canvas = canvasRef.current!;
    const fit = () => {
      const rect = canvas.getBoundingClientRect();
      const ratio = Math.min(4, Math.max(1, window.devicePixelRatio || 1));
      const w = Math.max(W, Math.round(rect.width * ratio));
      const h = Math.round((w * H) / W);
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
        redraw();
      }
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(canvas);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function toPath(): string {
    const encode = (digits: (v: number) => number) =>
      strokes.current
        .filter((s) => s.length > 0)
        .map((s) => {
          const pts = s.length === 1 ? [s[0]!, { x: s[0]!.x + 1, y: s[0]!.y }] : s;
          return pts.map((p, i) => `${i === 0 ? "M" : "L"}${digits(p.x)} ${digits(p.y)}`).join("");
        })
        .join("");
    const fine = encode((v) => v);
    // An extremely long signature falls back to whole units so it always fits the backup cell.
    return fine.length <= MAX_PATH ? fine : encode(Math.round);
  }

  useImperativeHandle(ref, () => ({
    clear() {
      strokes.current = [];
      redraw();
      setHasDrawn(false);
      onChange(null);
    },
  }));

  return (
    <div style={{ position: "relative", width: "100%" }}>
      <canvas
        ref={canvasRef}
        width={W}
        height={H}
        onPointerDown={(e) => {
          canvasRef.current!.setPointerCapture(e.pointerId);
          const p = pos(e);
          strokes.current.push([p]);
          drawing.current = true;
        }}
        onPointerMove={(e) => {
          if (!drawing.current) return;
          const p = pos(e);
          const stroke = strokes.current[strokes.current.length - 1]!;
          const last = stroke[stroke.length - 1]!;
          if (Math.hypot(p.x - last.x, p.y - last.y) < MIN_STEP) return;
          stroke.push(p);
          const c = ctx();
          c.beginPath();
          c.moveTo(last.x, last.y);
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
        <span style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: "#9aa", fontSize: 16, pointerEvents: "none" }}>Sign here</span>
      )}
    </div>
  );
});

/** Read-only rendering of a stored signature path. */
export function SignatureImage({ path, height = 34 }: { path: string; height?: number }) {
  const { width: W, height: H } = SIGNATURE_BOX;
  // Same box as before, but the ink itself is zoomed to fill it (proportions kept, centred).
  const b = signatureBounds(path, 6);
  const viewBox = b ? (() => {
    const aspect = W / H;
    const w = Math.max(b.width, b.height * aspect);
    const h = w / aspect;
    return `${b.x - (w - b.width) / 2} ${b.y - (h - b.height) / 2} ${w} ${h}`;
  })() : `0 0 ${W} ${H}`;
  return (
    <svg viewBox={viewBox} style={{ height, width: (height * W) / H, maxWidth: "100%", background: "#fff", borderRadius: "var(--radius-micro)", display: "block" }}>
      <path d={path} fill="none" stroke="#1c1d2e" strokeWidth={1.8} vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
