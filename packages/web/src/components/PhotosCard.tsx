import { useEffect, useRef, useState } from "react";
import type { Signoff, SignoffPhoto } from "@biosite-signoff/shared";
import { photoUrl, rememberPhoto, toJpegDataUrl } from "../lib/photos.js";
import { confirmDialog } from "../lib/confirmDialog.js";
import { localStamp } from "../lib/format.js";
import { card, errorMessage, ghost, primary } from "../lib/ui.js";

/** Photos per check — "take a photo" opens the iPad's camera. Taken photos show at once (also
 * offline) and upload with the rest of the queue; they're printed on the PDF after the form. */
export function PhotosCard(props: {
  signoff: Signoff;
  canAdd: boolean;
  canRemove: boolean;
  onAdd: (checkId: string, photoId: string, dataUrl: string, takenAt: string) => Promise<void>;
  onRemove: (photoId: string) => Promise<void>;
}) {
  const { signoff: s } = props;
  const photos = s.photos ?? [];
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<SignoffPhoto | null>(null);

  async function take(checkId: string, file: File | undefined) {
    if (!file) return;
    setBusy(checkId);
    setError(null);
    try {
      const dataUrl = await toJpegDataUrl(file);
      const photoId = crypto.randomUUID();
      await rememberPhoto(photoId, dataUrl);
      await props.onAdd(checkId, photoId, dataUrl, new Date().toISOString());
    } catch (err) {
      setError(`Couldn't use that photo: ${errorMessage(err)}`);
    } finally {
      setBusy(null);
    }
  }

  if (!props.canAdd && photos.length === 0) return null;

  return (
    <div style={{ ...card, marginBottom: 12 }}>
      <div style={{ fontWeight: 700, marginBottom: 4 }}>Photos</div>
      <div style={{ fontSize: 12.5, color: "var(--text-3)", marginBottom: 10 }}>Document anything worth showing. Photos are stored on the NAS and attached to the PDF.</div>
      {error && <div style={{ color: "var(--danger)", fontSize: 13, marginBottom: 8 }}>{error}</div>}
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {s.template.checks.map((c) => {
          const mine = photos.filter((p) => p.checkId === c.id);
          if (!props.canAdd && mine.length === 0) return null;
          return (
            <div key={c.id}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
                <span style={{ fontWeight: 600, fontSize: 14 }}>
                  {c.label} <span style={{ color: "var(--text-3)", fontWeight: 400 }}>({mine.length})</span>
                </span>
                {props.canAdd && <CameraButton label={busy === c.id ? "Saving…" : `📷 Photo — ${c.label}`} disabled={busy !== null} onFile={(f) => void take(c.id, f)} />}
              </div>
              {mine.length > 0 && (
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
              )}
            </div>
          );
        })}
      </div>

      {open && (
        <div role="dialog" onClick={() => setOpen(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)", zIndex: 50, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12, padding: 16 }}>
          <Photo id={open.id} style={{ maxWidth: "100%", maxHeight: "80vh", objectFit: "contain" }} />
          <div style={{ color: "#fff", fontSize: 13 }}>
            {s.template.checks.find((c) => c.id === open.checkId)?.label} · {localStamp(open.takenAt)} · {open.takenByName}
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

function CameraButton({ label, disabled, onFile }: { label: string; disabled: boolean; onFile: (f: File | undefined) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <button type="button" disabled={disabled} onClick={() => ref.current?.click()} style={{ ...primary, height: 52, opacity: disabled ? 0.6 : 1 }}>
        {label}
      </button>
      <input
        ref={ref}
        type="file"
        accept="image/*"
        capture="environment"
        style={{ display: "none" }}
        onChange={(e) => {
          onFile(e.target.files?.[0]);
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
