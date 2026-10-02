import { useEffect, useRef, useState } from "react";
import type { Signoff, SignoffPhoto } from "@biosite-signoff/shared";
import { photoUrl } from "../lib/photos.js";
import { listUsers, type UserSummary } from "../lib/api.js";
import { confirmDialog } from "../lib/confirmDialog.js";
import { localStamp } from "../lib/format.js";
import { card, ghost, primary } from "../lib/ui.js";

const checkLabel = (s: Signoff, checkId: string) => s.template.checks.find((c) => c.id === checkId)?.label ?? "check";

/** Every photo of the sign-off, grouped by check, as thumbnails — tap one to enlarge. Printed on
 * the PDF after the form. */
export function PhotosCard(props: { signoff: Signoff; canRemove: (p: SignoffPhoto) => boolean; onRemove: (photoId: string) => Promise<void> }) {
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
                  <div key={p.id} style={{ position: "relative" }}>
                    <button onClick={() => setOpen(p)} style={{ width: "100%", padding: 0, border: "1px solid var(--border)", borderRadius: "var(--radius-control)", overflow: "hidden", background: "var(--bg-deep)", cursor: "pointer", textAlign: "left" }}>
                      <Photo id={p.id} style={{ width: "100%", height: 110, objectFit: "cover", display: "block" }} />
                      <div className="mono" style={{ fontSize: 10, color: "var(--text-3)", padding: "4px 6px" }}>
                        {localStamp(p.takenAt)} · {p.takenByName}
                      </div>
                    </button>
                    {props.canRemove(p) && <RemoveX size={34} photo={p} onRemove={props.onRemove} />}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
      {open && <Lightbox signoff={s} photos={photos} start={open} canRemove={props.canRemove} onRemove={props.onRemove} onClose={() => setOpen(null)} />}
    </div>
  );
}

/** Small thumbnails of one check's photos, right under its 📷 button in the grid. */
export function PhotoStrip(props: { signoff: Signoff; checkId: string; canRemove: (p: SignoffPhoto) => boolean; onRemove: (photoId: string) => Promise<void> }) {
  const mine = (props.signoff.photos ?? []).filter((p) => p.checkId === props.checkId);
  const [open, setOpen] = useState<SignoffPhoto | null>(null);
  if (mine.length === 0) return null;
  return (
    <>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 3, marginTop: 4 }}>
        {mine.map((p) => (
          <div key={p.id} style={{ position: "relative" }}>
            <button onClick={() => setOpen(p)} aria-label={`Photo by ${p.takenByName}`} style={{ width: "100%", padding: 0, border: "1px solid var(--border)", borderRadius: 4, overflow: "hidden", background: "var(--bg-deep)", cursor: "pointer", aspectRatio: "1", display: "block" }}>
              <Photo id={p.id} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
            </button>
            {props.canRemove(p) && <RemoveX size={22} photo={p} onRemove={props.onRemove} />}
          </div>
        ))}
      </div>
      {open && <Lightbox signoff={props.signoff} photos={mine} start={open} canRemove={props.canRemove} onRemove={props.onRemove} onClose={() => setOpen(null)} />}
    </>
  );
}

/** Full-screen photo with ‹ › (and swipe) through the others. */
function Lightbox(props: { signoff: Signoff; photos: SignoffPhoto[]; start: SignoffPhoto; canRemove: (p: SignoffPhoto) => boolean; onRemove: (photoId: string) => Promise<void>; onClose: () => void }) {
  const [index, setIndex] = useState(() => Math.max(0, props.photos.findIndex((p) => p.id === props.start.id)));
  const touchX = useRef<number | null>(null);
  const p = props.photos[index];
  const many = props.photos.length > 1;
  const go = (d: number) => setIndex((i) => (i + d + props.photos.length) % props.photos.length);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") props.onClose();
      if (e.key === "ArrowRight") go(1);
      if (e.key === "ArrowLeft") go(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  if (!p) return null;
  const arrow = { ...ghost, width: 64, height: 64, fontSize: 30, color: "#fff", borderColor: "rgba(255,255,255,0.4)", background: "rgba(0,0,0,0.3)", flex: "none" as const };
  return (
    <div
      role="dialog"
      onClick={props.onClose}
      onTouchStart={(e) => (touchX.current = e.touches[0]?.clientX ?? null)}
      onTouchEnd={(e) => {
        const start = touchX.current;
        const end = e.changedTouches[0]?.clientX;
        if (start !== null && end !== undefined && Math.abs(end - start) > 50) go(end < start ? 1 : -1);
        touchX.current = null;
      }}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.9)", zIndex: 50, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12, padding: 16 }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12, maxWidth: "100%" }} onClick={(e) => e.stopPropagation()}>
        {many && (
          <button aria-label="Previous photo" style={arrow} onClick={() => go(-1)}>
            ‹
          </button>
        )}
        <Photo id={p.id} style={{ maxWidth: many ? "calc(100vw - 200px)" : "calc(100vw - 32px)", maxHeight: "78vh", objectFit: "contain" }} />
        {many && (
          <button aria-label="Next photo" style={arrow} onClick={() => go(1)}>
            ›
          </button>
        )}
      </div>
      <div style={{ color: "#fff", fontSize: 14, textAlign: "center" }}>
        Taken during <b>{checkLabel(props.signoff, p.checkId)}</b> by <b>{p.takenByName}</b> · {localStamp(p.takenAt)}
        {many && <span style={{ opacity: 0.7 }}> · {index + 1} / {props.photos.length}</span>}
      </div>
      <div style={{ display: "flex", gap: 8 }} onClick={(e) => e.stopPropagation()}>
        {props.canRemove(p) && (
          <button
            style={{ ...ghost, color: "var(--danger)", borderColor: "var(--danger)" }}
            onClick={async () => {
              if (await confirmDialog("Remove this photo from the sign-off?", { confirmLabel: "Remove", danger: true })) {
                props.onClose();
                await props.onRemove(p.id);
              }
            }}
          >
            Remove photo
          </button>
        )}
        <button style={{ ...primary, height: 52, minWidth: 120 }} onClick={props.onClose}>
          Close
        </button>
      </div>
    </div>
  );
}

/** The 📷 button under a check's Sign button — same size. Opens a panel to take several photos in
 * a row (camera again and again) or pick several at once from the gallery. Greyed out (tapping
 * explains why) when the photo would belong to somebody else's check. */
export function CameraButton(props: {
  signoff: Signoff;
  checkId: string;
  checkLabel: string;
  busy: boolean;
  blocked: string | null;
  onBlocked: (reason: string) => void;
  onFiles: (files: File[], as?: { userId: string; name: string }) => Promise<void>;
  canRemove: (p: SignoffPhoto) => boolean;
  onRemove: (photoId: string) => Promise<void>;
  /** Admin: may record photos in another operator's name. */
  isAdmin: boolean;
  me: { userId: string; name: string };
}) {
  const [open, setOpen] = useState(false);
  const count = (props.signoff.photos ?? []).filter((p) => p.checkId === props.checkId).length;
  const dim = props.blocked !== null;
  return (
    <>
      <button
        type="button"
        aria-label={`Take a photo for ${props.checkLabel}`}
        title={props.blocked ?? `Take photos for ${props.checkLabel}`}
        onClick={() => (props.blocked ? props.onBlocked(props.blocked) : setOpen(true))}
        style={{ ...primary, position: "relative", height: 56, width: "100%", padding: 0, fontSize: 24, lineHeight: 1, opacity: dim ? 0.35 : 1, cursor: dim ? "not-allowed" : "pointer" }}
      >
        {props.busy ? "…" : "📷"}
        {count > 0 && (
          <span className="mono" style={{ position: "absolute", top: 4, right: 6, fontSize: 11, fontWeight: 700 }}>
            {count}
          </span>
        )}
      </button>
      {open && <PhotoSheet {...props} onClose={() => setOpen(false)} />}
    </>
  );
}

function PhotoSheet(props: {
  signoff: Signoff;
  checkId: string;
  checkLabel: string;
  busy: boolean;
  onFiles: (files: File[], as?: { userId: string; name: string }) => Promise<void>;
  canRemove: (p: SignoffPhoto) => boolean;
  onRemove: (photoId: string) => Promise<void>;
  isAdmin: boolean;
  me: { userId: string; name: string };
  onClose: () => void;
}) {
  const camera = useRef<HTMLInputElement>(null);
  const gallery = useRef<HTMLInputElement>(null);
  const [working, setWorking] = useState(0);
  const mine = (props.signoff.photos ?? []).filter((p) => p.checkId === props.checkId);
  // Admin only: whose name the photos are recorded under — defaults to whoever signed this check.
  const [people, setPeople] = useState<UserSummary[]>([]);
  const signer = props.signoff.signatures.find((g) => g.checkId === props.checkId)?.userId;
  const [asUserId, setAsUserId] = useState(signer ?? props.me.userId);
  useEffect(() => {
    if (props.isAdmin) void listUsers().then((u) => setPeople(u.filter((x) => x.role !== "viewer" && x.role !== "parts" && !x.locked)), () => {});
  }, [props.isAdmin]);
  async function add(list: FileList | null) {
    const files = [...(list ?? [])];
    if (files.length === 0) return;
    setWorking(files.length);
    const person = people.find((u) => u.id === asUserId);
    try {
      await props.onFiles(files, person && person.id !== props.me.userId ? { userId: person.id, name: person.name } : undefined);
    } finally {
      setWorking(0);
    }
  }
  const big = { ...primary, height: 72, fontSize: 17, flex: "1 1 200px" };
  return (
    <div role="dialog" aria-label={`Photos for ${props.checkLabel}`} onClick={props.onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 40, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ ...card, width: "min(640px, 100%)", maxHeight: "90vh", overflowY: "auto", display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ fontWeight: 700, fontSize: 18 }}>Photos — {props.checkLabel}</div>
        {props.isAdmin && people.length > 0 && (
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13.5, flexWrap: "wrap" }}>
            <span style={{ color: "var(--text-3)" }}>Record as</span>
            <select value={asUserId} onChange={(e) => setAsUserId(e.target.value)} style={{ height: 44, borderRadius: "var(--radius-control)", border: "1px solid var(--border)", background: "var(--bg-deep)", color: "var(--text)", padding: "0 10px", fontSize: 14 }}>
              {people.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                  {u.id === props.me.userId ? " (me)" : ""}
                </option>
              ))}
            </select>
          </label>
        )}
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button type="button" style={big} disabled={working > 0} onClick={() => camera.current?.click()}>
            📷 Take photo
          </button>
          <button type="button" style={{ ...big, background: "transparent", color: "var(--accent)", border: "1px solid var(--accent)" }} disabled={working > 0} onClick={() => gallery.current?.click()}>
            🖼 Choose several
          </button>
        </div>
        <div style={{ fontSize: 12.5, color: "var(--text-3)" }}>
          {working > 0 ? `Saving ${working} photo${working === 1 ? "" : "s"}…` : "Take as many as you need — after each photo you come back here. Or pick several from the gallery at once."}
        </div>
        {mine.length > 0 && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(90px, 1fr))", gap: 6 }}>
            {mine.map((p) => (
              <div key={p.id} style={{ position: "relative" }}>
                <div style={{ border: "1px solid var(--border)", borderRadius: 6, overflow: "hidden", aspectRatio: "1" }}>
                  <Photo id={p.id} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                </div>
                {props.canRemove(p) && <RemoveX size={30} photo={p} onRemove={props.onRemove} />}
              </div>
            ))}
          </div>
        )}
        <button type="button" style={{ ...ghost, height: 56, fontSize: 15 }} onClick={props.onClose} disabled={working > 0}>
          Done ({mine.length} photo{mine.length === 1 ? "" : "s"})
        </button>
        <input ref={camera} type="file" accept="image/*" capture="environment" style={{ display: "none" }} onChange={(e) => void add(e.target.files).then(() => (e.target.value = ""))} />
        <input ref={gallery} type="file" accept="image/*" multiple style={{ display: "none" }} onChange={(e) => void add(e.target.files).then(() => (e.target.value = ""))} />
      </div>
    </div>
  );
}

/** The ✕ in a thumbnail's corner. */
function RemoveX({ photo, size, onRemove }: { photo: SignoffPhoto; size: number; onRemove: (photoId: string) => Promise<void> }) {
  return (
    <button
      type="button"
      aria-label={`Remove photo by ${photo.takenByName}`}
      title="Remove this photo"
      onClick={async (e) => {
        e.stopPropagation();
        if (await confirmDialog(`Remove this photo (${photo.takenByName}, ${localStamp(photo.takenAt)})?`, { confirmLabel: "Remove", danger: true })) await onRemove(photo.id);
      }}
      style={{ position: "absolute", top: 2, right: 2, width: size, height: size, borderRadius: "50%", border: "1px solid rgba(255,255,255,0.8)", background: "rgba(200,40,40,0.9)", color: "#fff", fontSize: size * 0.5, fontWeight: 700, lineHeight: 1, padding: 0, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
    >
      ✕
    </button>
  );
}

export function Photo({ id, style }: { id: string; style: React.CSSProperties }) {
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
  if (!src) return <div style={{ ...style, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-4)", fontSize: 11 }}>{failed ? "offline" : "…"}</div>;
  return <img src={src} alt="" style={style} />;
}
