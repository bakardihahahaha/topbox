import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { SignoffSummary } from "@biosite-signoff/shared";
import { getSignoffsOfType } from "../lib/api.js";
import { useData } from "../lib/useData.js";
import { useMe } from "../lib/meContext.js";
import { useSignoffTypes } from "../lib/signoffTypes.js";
import { stamp, topboxUrl } from "../lib/format.js";
import { SignoffsListPage } from "./SignoffsListPage.js";
import { card, chip, errorBox, ghost, input, page, primary } from "../lib/ui.js";

// The home screen: one tab per sign-off type (Setup → Types) listing every TopBox made as that
// type, filterable by completed / not completed and sorted by serial number. "All sign-offs" is
// the full searchable list — and the tab the screen always opens on.
const ALL = "__all";

export function HomePage() {
  const types = useSignoffTypes();
  const [tab, setTab] = useState<string>(ALL);
  const active = tab === ALL || types.some((t) => t.id === tab) ? tab : ALL;

  return (
    <div>
      <div style={{ ...page, paddingBottom: 0 }}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", borderBottom: "1px solid var(--border-soft)", paddingBottom: 12 }}>
          {[...types.map((t) => ({ id: t.id, label: t.name })), { id: ALL, label: "All sign-offs" }].map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              style={{
                height: 52,
                padding: "0 20px",
                borderRadius: "var(--radius-control)",
                border: `1px solid ${active === t.id ? "var(--accent)" : "var(--border)"}`,
                background: active === t.id ? "var(--accent-wash)" : "transparent",
                color: active === t.id ? "var(--accent)" : "var(--text-2)",
                fontWeight: 700,
                fontSize: 15,
                cursor: "pointer",
              }}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>
      {active === ALL ? <SignoffsListPage /> : <TypeTab typeId={active} typeName={types.find((t) => t.id === active)?.name ?? ""} />}
    </div>
  );
}

type StatusFilter = "all" | "open" | "done";

/** One sign-off type: every TopBox (visit) ever made as that type, whatever its stage — filtered
 * by completed / not completed, sorted by serial number either way. */
function TypeTab({ typeId, typeName }: { typeId: string; typeName: string }) {
  const navigate = useNavigate();
  const me = useMe();
  const list = useData<SignoffSummary[]>(() => getSignoffsOfType(typeId), [typeId]);
  const [status, setStatus] = useState<StatusFilter>("all");
  const [descending, setDescending] = useState(true);
  const all = list.data ?? [];
  const open = all.filter((s) => s.status !== "complete").length;
  const items = all
    .filter((s) => (status === "all" ? true : status === "done" ? s.status === "complete" : s.status !== "complete"))
    .sort((a, b) => (descending ? -1 : 1) * a.serialNumber.localeCompare(b.serialNumber, undefined, { numeric: true, sensitivity: "base" }));
  return (
    <div style={page}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 12, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 700 }}>
            {typeName} — {list.data ? items.length : "…"} TopBox{items.length === 1 ? "" : "es"}
          </div>
          {list.data && (
            <div style={{ fontSize: 12.5, color: "var(--text-3)" }}>
              {all.length} made as {typeName} · {all.length - open} completed · {open} not completed
            </div>
          )}
        </div>
        {me.role !== "viewer" && (
          <button style={{ ...primary, height: 52 }} onClick={() => navigate(`/signoffs/new?typeId=${encodeURIComponent(typeId)}`)}>
            + Start {typeName}
          </button>
        )}
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
        <select value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)} aria-label="Status" style={{ ...input, width: "auto", minWidth: 200, height: 52 }}>
          <option value="all">All</option>
          <option value="open">Not completed</option>
          <option value="done">Completed</option>
        </select>
        <button style={{ ...ghost, height: 52, minWidth: 200 }} onClick={() => setDescending((d) => !d)} title="Sort by serial number">
          Serial number {descending ? "↓ high → low" : "↑ low → high"}
        </button>
      </div>
      {list.error && <div style={errorBox}>{list.error}</div>}
      {list.data && items.length === 0 && <div style={{ color: "var(--text-4)", fontSize: 14 }}>No {status === "done" ? "completed " : status === "open" ? "unfinished " : ""}{typeName} TopBoxes.</div>}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 10 }}>
        {items.map((s) => (
          <Link key={s.id} to={topboxUrl(s.serialNumber, s.id)} style={{ ...card, color: "inherit", textDecoration: "none", display: "flex", flexDirection: "column", gap: 6, padding: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline" }}>
              <span className="mono" style={{ fontSize: 22, fontWeight: 700 }}>
                {s.serialNumber}
              </span>
              <span style={chip(s.status === "complete" ? "accent" : "warn")}>{s.status === "complete" ? "Complete" : s.progress}</span>
            </div>
            <div style={{ fontSize: 13, color: "var(--text-2)" }}>
              1st check: <b>{s.firstCheckAt ? stamp(s.firstCheckAt.slice(0, 10)) : "—"}</b>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
