import type { Role } from "@biosite-signoff/shared";
import { useState, type FormEvent } from "react";
import { createUser, deleteUser, endSessions, listUsers, setUserPin, updateUser, type UserSummary } from "../lib/api.js";
import { useData } from "../lib/useData.js";
import { useMe } from "../lib/meContext.js";
import { alertDialog, confirmDialog } from "../lib/confirmDialog.js";
import { SetupSubNav } from "../components/SetupSubNav.js";
import { card, chip, danger, errorBox, errorMessage, formatDateTime, ghost, h1, hint, input, label, page, primary } from "../lib/ui.js";

const PIN_RE = /^\d{4,8}$/;

// Admin actions here are never queued offline: a created/reset PIN has to be shown right now.
export function SetupUsersPage() {
  const me = useMe();
  const { data: users, error, setError, reload } = useData<UserSummary[]>(listUsers);
  const [form, setForm] = useState({ name: "", pin: "", role: "operator" as Role, canStart: false });
  const [editing, setEditing] = useState<{ id: string; name: string; pin: string } | null>(null);

  async function run(fn: () => Promise<unknown>) {
    setError(null);
    try {
      await fn();
      await reload();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function add(e: FormEvent) {
    e.preventDefault();
    const name = form.name.trim();
    await run(async () => {
      const { pin } = await createUser({ name, role: form.role, pin: form.pin || undefined, canStart: form.role === "admin" || form.canStart });
      setForm({ name: "", pin: "", role: "operator", canStart: false });
      if (!form.pin) await alertDialog(`PIN for ${name}:\n\n${pin}\n\nShown once — pass it on now.`, { title: "User created" });
    });
  }

  const pinOk = !form.pin || PIN_RE.test(form.pin);

  return (
    <div style={page}>
      <h1 style={h1}>Setup</h1>
      <SetupSubNav />
      <p style={hint}>
        Everyone here appears as a tile on the sign-in screen — they tap their name and type their PIN (4–8 digits). 3 wrong PINs lock the account for 5 minutes; 5 such locks in a row lock it
        until an admin unlocks it here. The name is also what's printed next to a signature.
      </p>
      <p style={hint}>
        <b>Starts sign-offs</b>: only operators with this ticked can open a new sign-off and do its 1st check. The others do the later checks (2nd, 3rd…). Admins always can.
      </p>

      <form onSubmit={add} style={{ ...card, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 8, marginBottom: 16, alignItems: "end" }}>
        <label style={field}>
          <span className="mono" style={label}>
            Full name
          </span>
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Jan Kowalski" style={input} />
        </label>
        <label style={field}>
          <span className="mono" style={label}>
            PIN (empty = random)
          </span>
          <input
            value={form.pin}
            onChange={(e) => setForm({ ...form, pin: e.target.value.replace(/\D/g, "").slice(0, 8) })}
            inputMode="numeric"
            placeholder="4–8 digits"
            className="mono"
            style={{ ...input, borderColor: pinOk ? "var(--border)" : "var(--danger)" }}
          />
        </label>
        <label style={field}>
          <span className="mono" style={label}>
            Role
          </span>
          <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })} style={input}>
            <option value="operator">Operator</option>
            <option value="admin">Admin</option>
            <option value="viewer">Viewer (view + PDFs only)</option>
            <option value="parts">Parts used (parts page only)</option>
          </select>
        </label>
        {form.role === "operator" && <StartsToggle checked={form.canStart} onChange={(canStart) => setForm({ ...form, canStart })} />}
        <button type="submit" style={{ ...primary, opacity: form.name.trim() && pinOk ? 1 : 0.5 }} disabled={!form.name.trim() || !pinOk}>
          Add user
        </button>
      </form>

      {error && <div style={errorBox}>{error}</div>}

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {users?.map((u) => (
          <div key={u.id} style={{ ...card, display: "flex", flexDirection: "column", gap: 8 }}>
            {editing?.id === u.id ? (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 8, alignItems: "end" }}>
                <label style={field}>
                  <span className="mono" style={label}>
                    Full name
                  </span>
                  <input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} style={input} />
                </label>
                <label style={field}>
                  <span className="mono" style={label}>
                    New PIN (empty = keep)
                  </span>
                  <input
                    value={editing.pin}
                    onChange={(e) => setEditing({ ...editing, pin: e.target.value.replace(/\D/g, "").slice(0, 8) })}
                    inputMode="numeric"
                    className="mono"
                    style={input}
                  />
                </label>
                <div style={{ display: "flex", gap: 6 }}>
                  <button
                    style={primary}
                    disabled={!editing.name.trim() || (editing.pin !== "" && !PIN_RE.test(editing.pin))}
                    onClick={() =>
                      run(async () => {
                        if (editing.name.trim() !== u.name) await updateUser(u.id, { name: editing.name.trim() });
                        if (editing.pin) await setUserPin(u.id, editing.pin);
                        setEditing(null);
                      })
                    }
                  >
                    Save
                  </button>
                  <button style={{ ...ghost, height: 38 }} onClick={() => setEditing(null)}>
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                <div>
                  <span style={{ fontWeight: 700 }}>{u.name}</span>
                  {u.id === me.userId && <span style={{ fontSize: 12, color: "var(--text-3)" }}> (you)</span>}
                  <div style={{ display: "flex", gap: 6, marginTop: 4, flexWrap: "wrap" }}>
                    <span style={chip(u.role === "admin" ? "accent" : "muted")}>{u.role}</span>
                    {u.role === "operator" && <span style={chip(u.canStart ? "accent" : "muted")}>{u.canStart ? "starts sign-offs + 1st check" : "later checks only"}</span>}
                    {u.locked && <span style={chip("danger")}>locked</span>}
                    {!u.locked && u.lockedUntil && <span style={chip("warn")}>locked until {formatDateTime(u.lockedUntil)}</span>}
                    {u.activeSessions.length > 0 && <span style={chip("accent")}>signed in</span>}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  <button style={ghost} onClick={() => setEditing({ id: u.id, name: u.name, pin: "" })}>
                    Edit name / PIN
                  </button>
                  <button
                    style={ghost}
                    onClick={async () => {
                      if (!(await confirmDialog(`Give ${u.name} a new random PIN? They'll be signed out everywhere.`, { confirmLabel: "New PIN" }))) return;
                      await run(async () => {
                        const { pin } = await setUserPin(u.id);
                        await alertDialog(`New PIN for ${u.name}:\n\n${pin}\n\nShown once.`, { title: "PIN reset" });
                      });
                    }}
                  >
                    Random PIN
                  </button>
                  {u.id !== me.userId && (
                    <select aria-label={`Role of ${u.name}`} value={u.role} onChange={(e) => run(() => updateUser(u.id, { role: e.target.value as Role }))} style={{ ...input, width: "auto", height: 44 }}>
                      <option value="admin">Admin</option>
                      <option value="operator">Operator</option>
                      <option value="viewer">Viewer</option>
                      <option value="parts">Parts used</option>
                    </select>
                  )}
                  {u.role === "operator" && <StartsToggle checked={u.canStart} onChange={(canStart) => void run(() => updateUser(u.id, { canStart }))} />}
                  {u.id !== me.userId && (u.locked || u.lockedUntil) && (
                    <button style={ghost} onClick={() => run(() => updateUser(u.id, { locked: false }))}>
                      Unlock
                    </button>
                  )}
                  {u.id !== me.userId && !u.locked && (
                    <button style={danger} onClick={() => run(() => updateUser(u.id, { locked: true }))}>
                      Lock
                    </button>
                  )}
                  {u.id !== me.userId && (
                    <button
                      style={danger}
                      onClick={async () => {
                        if (await confirmDialog(`Delete ${u.name}? Their signatures on existing sign-offs stay.`, { confirmLabel: "Delete", danger: true })) await run(() => deleteUser(u.id));
                      }}
                    >
                      Delete
                    </button>
                  )}
                </div>
              </div>
            )}
            {u.activeSessions.length > 0 && (
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, fontSize: 12, color: "var(--text-3)", flexWrap: "wrap" }}>
                <span className="mono">{u.activeSessions.map((s) => `${s.ip} (active ${formatDateTime(s.lastActivityAt)})`).join(" · ")}</span>
                {u.id !== me.userId && (
                  <button style={ghost} onClick={() => run(() => endSessions(u.id))}>
                    End sessions
                  </button>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

const field = { display: "flex", flexDirection: "column" as const, gap: 6 };

/** "Starts sign-offs" — may open new sign-offs and do the 1st check. */
function StartsToggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label
      style={{ display: "flex", alignItems: "center", gap: 8, height: 44, padding: "0 12px", border: `1px solid ${checked ? "var(--accent)" : "var(--border)"}`, borderRadius: "var(--radius-control)", cursor: "pointer", fontSize: 13, fontWeight: 700, color: checked ? "var(--accent)" : "var(--text-2)", whiteSpace: "nowrap" }}
      title="Can open new sign-offs and do the 1st check"
    >
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} style={{ width: 22, height: 22, accentColor: "var(--accent)" }} />
      Starts sign-offs
    </label>
  );
}
