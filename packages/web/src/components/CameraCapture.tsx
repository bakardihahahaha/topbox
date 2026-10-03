import { useEffect, useRef, useState } from "react";
import { ghost, primary } from "../lib/ui.js";

/** Phones and tablets: the file input with `capture` opens the real camera app. A computer has no
 * such thing — there the same input only opens a file picker — so it gets the live webcam view. */
export function isMobileDevice(): boolean {
  const ua = navigator.userAgent;
  return /Android|iPhone|iPad|iPod/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

/**
 * Live camera view (getUserMedia) with a "Take photo" button — for computers and kiosks, where a
 * file input can't open the camera. Each shot is handed over as a JPEG blob straight away;
 * `multiple` keeps the camera open for the next one. Needs https (the site has it).
 */
export function CameraCapture(props: { title: string; multiple?: boolean; onPhoto: (photo: Blob) => Promise<void> | void; onClose: () => void; onFallback?: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [taken, setTaken] = useState(0);
  const [flash, setFlash] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live: MediaStream | null = null;
    let cancelled = false;
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("This browser can't use the camera here.");
      return;
    }
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false })
      .then(
        (s) => {
          if (cancelled) return s.getTracks().forEach((t) => t.stop());
          live = s;
          setStream(s);
        },
        (err: Error) =>
          setError(
            err.name === "NotAllowedError"
              ? "The camera was blocked. Allow the camera for this site (the camera icon in the address bar) and try again."
              : err.name === "NotFoundError"
                ? "No camera found on this computer."
                : `Couldn't start the camera (${err.message || err.name}).`,
          ),
      );
    return () => {
      cancelled = true;
      live?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  useEffect(() => {
    if (video.current && stream) {
      video.current.srcObject = stream;
      void video.current.play().catch(() => {});
    }
  }, [stream]);

  async function shoot() {
    const v = video.current;
    if (!v || !v.videoWidth || busy) return;
    const canvas = document.createElement("canvas");
    canvas.width = v.videoWidth;
    canvas.height = v.videoHeight;
    canvas.getContext("2d")!.drawImage(v, 0, 0);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.9));
    if (!blob) return;
    setFlash(true);
    setTimeout(() => setFlash(false), 150);
    setBusy(true);
    try {
      await props.onPhoto(blob);
      setTaken((n) => n + 1);
      if (!props.multiple) props.onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div role="dialog" aria-label={props.title} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.92)", zIndex: 60, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12, padding: 16 }}>
      <div style={{ color: "#fff", fontWeight: 700, fontSize: 17 }}>{props.title}</div>
      {error ? (
        <div style={{ color: "#fff", maxWidth: 520, textAlign: "center", fontSize: 14.5, lineHeight: 1.5 }}>{error}</div>
      ) : (
        <video
          ref={video}
          playsInline
          muted
          style={{ maxWidth: "100%", maxHeight: "70vh", borderRadius: 8, background: "#000", outline: flash ? "6px solid #fff" : "none", transition: "outline 0.1s" }}
        />
      )}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "center" }}>
        {!error && (
          <button type="button" style={{ ...primary, height: 64, minWidth: 200, fontSize: 18 }} onClick={() => void shoot()} disabled={!stream || busy}>
            {busy ? "Saving…" : "📷 Take photo"}
          </button>
        )}
        {error && props.onFallback && (
          <button type="button" style={{ ...primary, height: 56 }} onClick={props.onFallback}>
            Choose a file instead
          </button>
        )}
        <button type="button" style={{ ...ghost, height: 64, minWidth: 140, color: "#fff", borderColor: "rgba(255,255,255,0.5)" }} onClick={props.onClose}>
          {taken > 0 ? `Done (${taken})` : "Close"}
        </button>
      </div>
    </div>
  );
}
