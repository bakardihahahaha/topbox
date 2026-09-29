import { useEffect, useRef, useState } from "react";
import type { Signoff, SignoffPhoto } from "@biosite-signoff/shared";
import { photoUrl } from "../lib/photos.js";
import { confirmDialog } from "../lib/confirmDialog.js";
import { localStamp } from "../lib/format.js";
import { card, ghost, primary } from "../lib/ui.js";

/** The photos taken during each check (they're taken with the 📷 button under each check's Sign
 * button). Printed on the PDF after the form. */
export function PhotosCard(props: { signoff: Signoff; canRemove: boolean; onRemove: (photoId: string) => Promise<void> }) {
  const { signoff: s } = props;
  const photos = s.photos ?? [];
  const [open, setOpen] = useState<SignoffPhoto | null>(null);
  if (photos.length === 0) return null;

  return (
    <div style={{ ...card, marginBottom: 12 }}>
      <div style={{ fontWeight: 700, marginBottom: 10 }}>Photos</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {s.template.checks.map((c) => {
          const mine = photos.filter((p) => p.checkId === c.id);
          if (mine.length === 0) return null;
          return (
            <div key={c.id}>
              <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 8 }}>
                {c.label} <span style={{ color: "var(--text-3)", fontWeight: 400 }}>({mine.length})</span>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))", gap: 8 }}>
                {mine.map((p) => (
                  <button key={p.id} onClick={() => setOpen(p)} style={{ padding: 0, border: "1px solid var(--border)", borderRadius: "var(--radius-control)", overflow: "hidden", background: "var(--bg-deep)", cursor: "pointer", textAlign: "left" }}>
                    <Photo id={p.id} style={{ width: "100%", height: 110, objectFit: "cover", display: "block" }} />
                    <div className="mono" style={{ fontSize: 10, color: "var(--text-3)", padding: "4px 6px" }}>
                      {localStamp(p.takenAt)} · {p.takenByName}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {open && (
        <div role="dialog" onClick={() => setOpen(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)", zIndex: 50, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12, padding: 16 }}>
          <Photo id={open.id} style={{ maxWidth: "100%", maxHeight: "80vh", objectFit: "contain" }} />
          <div style={{ color: "#fff", fontSize: 13 }}>
            Taken during {s.template.checks.find((c) => c.id === open.checkId)?.label} by {open.takenByName} · {localStamp(open.takenAt)}
          </div>
          <div style={{ display: "flex", gap: 8 }} onClick={(e) => e.stopPropagation()}>
            {props.canRemove && (
              <button
                style={{ ...ghost, color: "var(--danger)", borderColor: "var(--danger)" }}
                onClick={async () => {
                  if (await confirmDialog("Remove this photo from the sign-off?", { confirmLabel: "Remove", danger: true })) {
                    setOpen(null);
                    await props.onRemove(open.id);
                  }
                }}
              >
                Remove photo
              </button>
            )}
            <button style={primary} onClick={() => setOpen(null)}>
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** The 📷 button under a check's Sign button — same size. Opens the camera; greyed out (tapping
 * explains why) when the photo would belong to somebody else's check. */
export function CameraButton(props: { checkLabel: string; count: number; busy: boolean; blocked: string | null; onBlocked: (reason: string) => void; onFile: (f: File | undefined) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const dim = props.blocked !== null || props.busy;
  return (
    <>
      <button
        type="button"
        aria-label={`Take a photo for ${props.checkLabel}`}
        title={props.blocked ?? `Take a photo for ${props.checkLabel}`}
        disabled={props.busy}
        onClick={() => (props.blocked ? props.onBlocked(props.blocked) : ref.current?.click())}
        style={{ ...primary, position: "relative", height: 56, width: "100%", padding: 0, fontSize: 24, lineHeight: 1, opacity: dim ? 0.35 : 1, cursor: props.blocked ? "not-allowed" : "pointer" }}
      >
        {props.busy ? "…" : "📷"}
        {props.count > 0 && (
          <span className="mono" style={{ position: "absolute", top: 4, right: 6, fontSize: 11, fontWeight: 700 }}>
            {props.count}
          </span>
        )}
      </button>
      <input
        ref={ref}
        type="file"
        accept="image/*"
        capture="environment"
        style={{ display: "none" }}
        onChange={(e) => {
          props.onFile(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
    </>
  );
}

function Photo({ id, style }: { id: string; style: React.CSSProperties }) {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    photoUrl(id).then(
      (u) => alive && setSrc(u),
      () => alive && setFailed(true),
    );
    return () => {
      alive = false;
    };
  }, [id]);
  if (!src) return <div style={{ ...style, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-4)", fontSize: 11 }}>{failed ? "not available offline" : "…"}</div>;
  return <img src={src} alt="" style={style} />;
}
