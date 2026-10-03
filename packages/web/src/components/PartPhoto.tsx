import { useEffect, useState } from "react";
import { authedFetch } from "../lib/client.js";
import { primary } from "../lib/ui.js";

// Reference photo of a part (Setup → Parts): a thumbnail that opens big on a tap, so operators
// can check what a part looks like before ticking it. Loaded once per photo version (the file
// name changes with every new photo), kept for this page load.
const urls = new Map<string, Promise<string>>();

function partPhotoUrl(partId: string, file: string): Promise<string> {
  const key = `${partId}:${file}`;
  let url = urls.get(key);
  if (!url) {
    url = authedFetch(`/api/parts/${partId}/photo?v=${encodeURIComponent(file)}`)
      .then((r) => r.blob())
      .then((b) => URL.createObjectURL(b));
    url.catch(() => urls.delete(key));
    urls.set(key, url);
  }
  return url;
}

export function PartPhotoThumb({ partId, file, label, size = 52 }: { partId: string; file: string; label: string; size?: number }) {
  const [src, setSrc] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    let alive = true;
    partPhotoUrl(partId, file).then(
      (u) => alive && setSrc(u),
      () => {},
    );
    return () => {
      alive = false;
    };
  }, [partId, file]);
  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen(true);
        }}
        aria-label={`Photo of ${label}`}
        title="Tap to enlarge"
        style={{ width: size, height: size, flex: "none", padding: 0, border: "1px solid var(--border)", borderRadius: 6, overflow: "hidden", background: "var(--bg-deep)", cursor: "zoom-in" }}
      >
        {src && <img src={src} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />}
      </button>
      {open && (
        <div role="dialog" aria-label={`Photo of ${label}`} onClick={() => setOpen(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.9)", zIndex: 60, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12, padding: 16 }}>
          {src && <img src={src} alt={label} style={{ maxWidth: "100%", maxHeight: "80vh", objectFit: "contain", borderRadius: 6 }} />}
          <div style={{ color: "#fff", fontSize: 15, fontWeight: 600, textAlign: "center" }}>{label}</div>
          <button type="button" style={{ ...primary, height: 52, minWidth: 140 }} onClick={() => setOpen(false)}>
            Close
          </button>
        </div>
      )}
    </>
  );
}
