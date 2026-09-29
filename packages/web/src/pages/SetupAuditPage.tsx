import { listAudit, type AuditRow } from "../lib/api.js";
import { useData } from "../lib/useData.js";
import { SetupSubNav } from "../components/SetupSubNav.js";
import { errorBox, formatDateTime, h1, hint, page } from "../lib/ui.js";

export function SetupAuditPage() {
  const { data, error } = useData<AuditRow[]>(() => listAudit(300));
  return (
    <div style={page}>
      <h1 style={h1}>Setup</h1>
      <SetupSubNav />
      <p style={hint}>The last 300 events — sign-ins (including blocked ones), and every change anyone made.</p>
      {error && <div style={errorBox}>{error}</div>}
      <div style={{ overflowX: "auto" }}>
        <table className="mono" style={{ width: "100%", borderCollapse: "collapse", fontSize: 11.5 }}>
          <thead>
            <tr style={{ background: "var(--head-row)", textAlign: "left" }}>
              {["When", "Who", "Action", "What", "IP", "Detail"].map((h) => (
                <th key={h} style={{ padding: "6px 8px", color: "var(--text-3)" }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data?.map((e) => (
              <tr key={e.id} style={{ borderTop: "1px solid var(--border-soft)", color: e.action.startsWith("AUTH_") && e.action !== "AUTH_SUCCESS" ? "var(--warn)" : "var(--text-2)" }}>
                <td style={td}>{formatDateTime(e.at)}</td>
                <td style={td}>{e.actorName ?? "—"}</td>
                <td style={td}>{e.action}</td>
                <td style={td}>{e.entityId ?? e.entity}</td>
                <td style={td}>{e.ip ?? ""}</td>
                <td style={{ ...td, maxWidth: 360, overflow: "hidden", textOverflow: "ellipsis" }}>{e.detail ? JSON.stringify(e.detail) : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const td = { padding: "5px 8px", whiteSpace: "nowrap" as const, verticalAlign: "top" as const };
