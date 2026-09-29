import { useState, type FormEvent } from "react";
import { createUser, endSessions, listUsers, resetPassword, updateUser, type UserSummary } from "../lib/api.js";
import { useData } from "../lib/useData.js";
import { useMe } from "../lib/meContext.js";
import { confirmDialog, alertDialog } from "../lib/confirmDialog.js";
import { SetupSubNav } from "../components/SetupSubNav.js";
import { card, chip, danger, errorBox, errorMessage, formatDateTime, ghost, h1, hint, input, page, primary } from "../lib/ui.js";

// Admin actions here are never queued offline: creating a user or resetting a password hands back
// a one-time password that has to be shown right now.
export function SetupUsersPage() {
  const me = useMe();
  const { data: users, error, setError, reload } = useData<UserSummary[]>(listUsers);
  const [form, setForm] = useState({ username: "", name: "", role: "operator" as "admin" | "operator" });
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);

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
    await run(async () => {
      const { password } = await createUser(form);
      setForm({ username: "", name: "", role: "operator" });
      await alertDialog(`Password for "${form.username}":\n\n${password}\n\nShown once — write it down or pass it on now.`, { title: "User created" });
    });
  }

  return (
    <div style={page}>
      <h1 style={h1}>Setup</h1>
      <SetupSubNav />
      <p style={hint}>Operators fill in and sign sign-offs. Admins also manage templates, parts, users and the backup. The name is what gets printed next to a signature.</p>

      <form onSubmit={add} style={{ ...card, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 8, marginBottom: 16 }}>
        <input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} placeholder="Username (login)" autoCapitalize="none" style={input} />
        <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Full name (printed)" style={input} />
        <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as "admin" | "operator" })} style={input}>
          <option value="operator">Operator</option>
          <option value="admin">Admin</option>
        </select>
        <button type="submit" style={primary} disabled={!form.username.trim()}>
          Create user
        </button>
      </form>

      {error && <div style={errorBox}>{error}</div>}

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {users?.map((u) => (
          <div key={u.id} style={{ ...card, display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
              <div>
                {renaming?.id === u.id ? (
                  <span style={{ display: "inline-flex", gap: 6 }}>
                    <input autoFocus value={renaming.name} onChange={(e) => setRenaming({ id: u.id, name: e.target.value })} style={{ ...input, height: 30, width: 200 }} />
                    <button style={{ ...primary, height: 30 }} onClick={() => run(async () => { await updateUser(u.id, { name: renaming.name }); setRenaming(null); })}>
                      Save
                    </button>
                    <button style={ghost} onClick={() => setRenaming(null)}>
                      Cancel
                    </button>
                  </span>
                ) : (
                  <span style={{ fontWeight: 700 }}>{u.name}</span>
                )}{" "}
                <span className="mono" style={{ fontSize: 12, color: "var(--text-3)" }}>
                  @{u.username}
                </span>
                <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
                  <span style={chip(u.role === "admin" ? "accent" : "muted")}>{u.role}</span>
                  {u.locked && <span style={chip("danger")}>locked</span>}
                  {u.activeSessions.length > 0 && <span style={chip("warn")}>signed in</span>}
                </div>
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                <button style={ghost} onClick={() => setRenaming({ id: u.id, name: u.name })}>
                  Rename
                </button>
                {u.id !== me.userId && (
                  <button style={ghost} onClick={() => run(() => updateUser(u.id, { role: u.role === "admin" ? "operator" : "admin" }))}>
                    Make {u.role === "admin" ? "operator" : "admin"}
                  </button>
                )}
                <button
                  style={ghost}
                  onClick={async () => {
                    if (!(await confirmDialog(`Reset ${u.name}'s password? They'll be signed out everywhere.`, { confirmLabel: "Reset" }))) return;
                    await run(async () => {
                      const { password } = await resetPassword(u.id);
                      await alertDialog(`New password for "${u.username}":\n\n${password}\n\nShown once.`, { title: "Password reset" });
                    });
                  }}
                >
                  Reset password
                </button>
                {u.id !== me.userId && (
                  <button style={u.locked ? ghost : danger} onClick={() => run(() => updateUser(u.id, { locked: !u.locked }))}>
                    {u.locked ? "Unlock" : "Lock"}
                  </button>
                )}
              </div>
            </div>
            {u.activeSessions.length > 0 && (
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, fontSize: 12, color: "var(--text-3)", flexWrap: "wrap" }}>
                <span className="mono">
                  {u.activeSessions.map((s) => `${s.ip} (active ${formatDateTime(s.lastActivityAt)})`).join(" · ")}
                </span>
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
