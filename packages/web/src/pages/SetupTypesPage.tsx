import { useEffect, useState } from "react";
import { allowsRefurbishedR, isOncePerTopbox, type SignoffType } from "@biosite-signoff/shared";
import { fetchSignoffTypes, rememberSignoffTypes, saveSignoffTypes } from "../lib/signoffTypes.js";
import { mutateOrQueue } from "../lib/offlineQueue.js";
import { withSaving } from "../lib/savingStatus.js";
import { SetupSubNav } from "../components/SetupSubNav.js";
import { card, errorBox, errorMessage, ghost, h1, hint, iconButton, infoBox, input, page, primary } from "../lib/ui.js";

function move<T>(list: T[], i: number, by: number): T[] {
  const j = i + by;
  if (j < 0 || j >= list.length) return list;
  const next = [...list];
  [next[i], next[j]] = [next[j]!, next[i]!];
  return next;
}

/** The buttons on the New sign-off screen — "New (UK)", "New (USA)", "Service"… */
export function SetupTypesPage() {
  const [types, setTypes] = useState<SignoffType[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchSignoffTypes().then(setTypes, (err) => setError(errorMessage(err)));
  }, []);

  if (!types) return <div style={page}>{error ? <div style={errorBox}>{error}</div> : <span style={{ color: "var(--text-3)", fontSize: 13 }}>Loading…</span>}</div>;

  const set = (next: SignoffType[]) => {
    setSaved(false);
    setTypes(next);
  };
  const setAt = (i: number, patch: Partial<SignoffType>) => set(types.map((t, j) => (j === i ? { ...t, ...patch } : t)));

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const next = types!.filter((t) => t.name.trim());
      // Applied on this device at once; the server copy follows (queued if offline).
      setTypes(next);
      rememberSignoffTypes(next);
      setSaved(true);
      const outcome = await withSaving(() => mutateOrQueue({ kind: "saveSignoffTypes", types: next }, () => saveSignoffTypes(next)));
      if (outcome.synced) {
        setTypes(outcome.result);
        rememberSignoffTypes(outcome.result);
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={page}>
      <h1 style={h1}>Setup</h1>
      <SetupSubNav />
      <p style={hint}>
        The type buttons on the New sign-off screen, in this order. Tick "Replaced parts" for service-style types — only those show the replaced-parts list. Tick "Only once per TopBox" for types like New: once a TopBox has had a visit of that type, that type can't be picked for it again (the other types stay available). Tick "R" refurbished for the types where the serial number may get the refurbished R (667 → 667R) — only those show the +R button. Renaming or deleting a type
        never changes sign-offs already made; they keep the name they were created with.
      </p>
      {error && <div style={errorBox}>{error}</div>}
      {saved && <div style={infoBox}>Saved — the New sign-off screen shows these buttons now.</div>}

      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 12 }}>
        {types.map((t, i) => (
          <div key={t.id} style={{ ...card, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <input value={t.name} onChange={(e) => setAt(i, { name: e.target.value })} placeholder="Button name, e.g. New (UK)" style={{ ...input, flex: "1 1 160px", fontWeight: 700 }} />
            <input value={t.description} onChange={(e) => setAt(i, { description: e.target.value })} placeholder="Small line under it, e.g. Check only" style={{ ...input, flex: "2 1 200px" }} />
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, flex: "none", cursor: "pointer" }}>
              <input type="checkbox" checked={t.allowsParts} onChange={(e) => setAt(i, { allowsParts: e.target.checked })} style={{ width: 24, height: 24, accentColor: "var(--accent)" }} />
              Replaced parts
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, flex: "none", cursor: "pointer" }} title="Unticked = can be used for every visit">
              <input type="checkbox" checked={isOncePerTopbox(t)} onChange={(e) => setAt(i, { oncePerTopbox: e.target.checked })} style={{ width: 24, height: 24, accentColor: "var(--accent)" }} />
              Only once per TopBox
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, flex: "none", cursor: "pointer" }} title='Shows the "+R refurbished" button for this type'>
              <input type="checkbox" checked={allowsRefurbishedR(t)} onChange={(e) => setAt(i, { refurbishedR: e.target.checked })} style={{ width: 24, height: 24, accentColor: "var(--accent)" }} />
              "R" refurbished
            </label>
            <div style={{ display: "flex", gap: 4, flex: "none" }}>
              <button style={iconButton} onClick={() => set(move(types, i, -1))} aria-label="Move up">
                ↑
              </button>
              <button style={iconButton} onClick={() => set(move(types, i, 1))} aria-label="Move down">
                ↓
              </button>
              <button style={{ ...iconButton, color: "var(--danger)" }} disabled={types.length <= 1} onClick={() => set(types.filter((_, j) => j !== i))} aria-label="Remove">
                ✕
              </button>
            </div>
          </div>
        ))}
      </div>

      <div style={{ display: "flex", gap: 8 }}>
        <button style={{ ...ghost, height: 38 }} disabled={types.length >= 12} onClick={() => set([...types, { id: crypto.randomUUID(), name: "", description: "", allowsParts: false, oncePerTopbox: false, refurbishedR: false }])}>
          + Add type
        </button>
        <button style={primary} onClick={() => void save()} disabled={saving}>
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}
