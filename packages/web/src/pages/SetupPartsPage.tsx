import { useRef, useState, type FormEvent } from "react";
import type { Part } from "@biosite-signoff/shared";
import { createPart, deletePart, listParts, removePartPhoto, reorderParts, setPartPhoto, updatePart } from "../lib/api.js";
import { toJpegDataUrl } from "../lib/photos.js";
import { PartPhotoThumb } from "../components/PartPhoto.js";
import { CameraCapture, isMobileDevice } from "../components/CameraCapture.js";
import { useData } from "../lib/useData.js";
import { mutateOrQueue } from "../lib/offlineQueue.js";
import { withSaving } from "../lib/savingStatus.js";
import { confirmDialog } from "../lib/confirmDialog.js";
import { SetupSubNav } from "../components/SetupSubNav.js";
import { card, danger, errorBox, errorMessage, ghost, h1, hint, input, page, primary } from "../lib/ui.js";

export function SetupPartsPage() {
  const { data: parts, setData, error, setError, reload } = useData<Part[]>(listParts);
  const [form, setForm] = useState({ partNumber: "", name: "", description: "" });
  const [editing, setEditing] = useState<Part | null>(null);

  async function add(e: FormEvent) {
    e.preventDefault();
    const input = { partNumber: form.partNumber.trim(), name: form.name.trim(), description: form.description.trim() };
    if (!input.partNumber || !input.name) return;
    const partId = crypto.randomUUID();
    const now = new Date().toISOString();
    setError(null);
    setData((ps) => [...(ps ?? []), { id: partId, ...input, createdAt: now, updatedAt: now }]);
    setForm({ partNumber: "", name: "", description: "" });
    try {
      const outcome = await withSaving(() => mutateOrQueue({ kind: "createPart", partId, input }, () => createPart(partId, input)));
      if (outcome.synced) await reload();
    } catch (err) {
      setError(errorMessage(err));
      await reload();
    }
  }

  async function saveEdit() {
    if (!editing) return;
    const patch = { partNumber: editing.partNumber.trim(), name: editing.name.trim(), description: editing.description.trim() };
    setError(null);
    setData((ps) => ps?.map((p) => (p.id === editing.id ? { ...p, ...patch } : p)) ?? ps);
    const id = editing.id;
    setEditing(null);
    try {
      await withSaving(() => mutateOrQueue({ kind: "updatePart", partId: id, patch }, () => updatePart(id, patch)));
    } catch (err) {
      setError(errorMessage(err));
      await reload();
    }
  }

  /** Moves a part one place up (-1) or down (+1) — sign-offs list the parts in this order. */
  async function move(index: number, by: -1 | 1) {
    if (!parts) return;
    const target = index + by;
    if (target < 0 || target >= parts.length) return;
    const next = [...parts];
    [next[index], next[target]] = [next[target]!, next[index]!];
    const ids = next.map((x) => x.id);
    setError(null);
    setData(next);
    try {
      await withSaving(() => mutateOrQueue({ kind: "reorderParts", ids }, () => reorderParts(ids)));
    } catch (err) {
      setError(errorMessage(err));
      await reload();
    }
  }

  // Reference photo (shown to operators next to the part on a sign-off; saved on the NAS).
  const fileInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);
  const [photoFor, setPhotoFor] = useState<Part | null>(null);
  const [webcamFor, setWebcamFor] = useState<Part | null>(null);
  const [photoBusy, setPhotoBusy] = useState<string | null>(null);
  async function savePhoto(p: Part, image: Blob) {
    setError(null);
    setPhotoBusy(p.id);
    try {
      const updated = await setPartPhoto(p.id, await toJpegDataUrl(image));
      setData((ps) => ps?.map((x) => (x.id === p.id ? updated : x)) ?? ps);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPhotoBusy(null);
    }
  }
  async function dropPhoto(p: Part) {
    if (!(await confirmDialog(`Remove the photo of ${p.partNumber} "${p.name}"?`, { confirmLabel: "Remove", danger: true }))) return;
    try {
      const updated = await removePartPhoto(p.id);
      setData((ps) => ps?.map((x) => (x.id === p.id ? updated : x)) ?? ps);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function remove(p: Part) {
    if (!(await confirmDialog(`Delete part ${p.partNumber} "${p.name}"? Sign-offs that already recorded it keep it; it's removed from every template's list.`, { confirmLabel: "Delete", danger: true }))) return;
    setData((ps) => ps?.filter((x) => x.id !== p.id) ?? ps);
    try {
      await withSaving(() => mutateOrQueue({ kind: "deletePart", partId: p.id }, () => deletePart(p.id)));
    } catch (err) {
      setError(errorMessage(err));
      await reload();
    }
  }

  return (
    <div style={page}>
      <h1 style={h1}>Setup</h1>
      <SetupSubNav />
      <p style={hint}>Every part that can be replaced during a service. Define them once here, then tick which ones apply to each template — operators only ever tick them, never type them. Use ↑ ↓ to set the order: the sign-off form and the PDF list the parts in this same order. Add a photo so operators can see what a part looks like (tap it on the sign-off to enlarge); photos are saved on the NAS in the part-photos folder.</p>

      <form onSubmit={add} style={{ ...card, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 8, marginBottom: 16 }}>
        <input value={form.partNumber} onChange={(e) => setForm({ ...form, partNumber: e.target.value })} placeholder="Part number" className="mono" style={input} />
        <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Name" style={input} />
        <input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Description (optional)" style={input} />
        <button type="submit" style={primary} disabled={!form.partNumber.trim() || !form.name.trim()}>
          Add part
        </button>
      </form>

      {error && <div style={errorBox}>{error}</div>}
      {parts?.length === 0 && <div style={{ color: "var(--text-4)", fontSize: 13 }}>No parts yet — add one above.</div>}

      <input
        ref={fileInput}
        type="file"
        accept="image/*"
        style={{ display: "none" }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f && photoFor) void savePhoto(photoFor, f);
          e.target.value = "";
        }}
      />
      <input
        ref={cameraInput}
        type="file"
        accept="image/*"
        capture="environment"
        style={{ display: "none" }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f && photoFor) void savePhoto(photoFor, f);
          e.target.value = "";
        }}
      />
      {webcamFor && (
        <CameraCapture
          title={`Photo of ${webcamFor.partNumber} — ${webcamFor.name}`}
          onPhoto={(blob) => savePhoto(webcamFor, blob)}
          onClose={() => setWebcamFor(null)}
          onFallback={() => {
            setWebcamFor(null);
            fileInput.current?.click();
          }}
        />
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {parts?.map((p, i) =>
          editing?.id === p.id ? (
            <div key={p.id} style={{ ...card, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 8 }}>
              <input value={editing.partNumber} onChange={(e) => setEditing({ ...editing, partNumber: e.target.value })} className="mono" style={input} />
              <input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} style={input} />
              <input value={editing.description} onChange={(e) => setEditing({ ...editing, description: e.target.value })} placeholder="Description" style={input} />
              <div style={{ display: "flex", gap: 6 }}>
                <button style={primary} onClick={() => void saveEdit()} disabled={!editing.partNumber.trim() || !editing.name.trim()}>
                  Save
                </button>
                <button style={{ ...ghost, height: 38 }} onClick={() => setEditing(null)}>
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div key={p.id} style={{ ...card, padding: "10px 14px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
              <div style={{ display: "flex", gap: 4, flex: "none" }}>
                <button style={{ ...ghost, width: 44, padding: 0, opacity: i === 0 ? 0.35 : 1 }} onClick={() => void move(i, -1)} disabled={i === 0} aria-label={`Move ${p.partNumber} up`} title="Move up">
                  ↑
                </button>
                <button style={{ ...ghost, width: 44, padding: 0, opacity: i === parts.length - 1 ? 0.35 : 1 }} onClick={() => void move(i, 1)} disabled={i === parts.length - 1} aria-label={`Move ${p.partNumber} down`} title="Move down">
                  ↓
                </button>
              </div>
              <div style={{ minWidth: 0, flex: 1 }}>
                <span className="mono" style={{ fontSize: 12.5, color: "var(--text-3)", marginRight: 10 }}>
                  {p.partNumber}
                </span>
                <span style={{ fontWeight: 600 }}>{p.name}</span>
                {p.description && <div style={{ fontSize: 12, color: "var(--text-3)" }}>{p.description}</div>}
              </div>
              {p.photoFile && <PartPhotoThumb partId={p.id} file={p.photoFile} label={`${p.partNumber} — ${p.name}`} size={56} />}
              <div style={{ display: "flex", gap: 6, flex: "none", flexWrap: "wrap", justifyContent: "flex-end" }}>
                <button
                  style={ghost}
                  disabled={photoBusy === p.id}
                  onClick={() => {
                    setPhotoFor(p);
                    if (isMobileDevice()) cameraInput.current?.click();
                    else setWebcamFor(p);
                  }}
                  title="Take a photo of this part with the camera"
                >
                  {photoBusy === p.id ? "Saving…" : "📷 Camera"}
                </button>
                <button
                  style={ghost}
                  disabled={photoBusy === p.id}
                  onClick={() => {
                    setPhotoFor(p);
                    fileInput.current?.click();
                  }}
                  title="Upload a photo of this part"
                >
                  {p.photoFile ? "Change photo" : "Upload photo"}
                </button>
                {p.photoFile && (
                  <button style={danger} onClick={() => void dropPhoto(p)}>
                    Remove photo
                  </button>
                )}
                <button style={ghost} onClick={() => setEditing(p)}>
                  Edit
                </button>
                <button style={danger} onClick={() => void remove(p)}>
                  Delete
                </button>
              </div>
            </div>
          ),
        )}
      </div>
    </div>
  );
}
