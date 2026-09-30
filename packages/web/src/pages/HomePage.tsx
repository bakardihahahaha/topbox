import { useState } from "react";
import { useSignoffTypes } from "../lib/signoffTypes.js";
import { SignoffTable } from "./SignoffTable.js";
import { page } from "../lib/ui.js";

// The home screen: "All sign-offs" (the tab it always opens on) and one tab per sign-off type
// (Setup → Types). Every tab is the same SignoffTable, so switching tabs changes only what's listed.
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
      {/* Every tab is the same list — only its content and default order differ. */}
      {active === ALL ? (
        <SignoffTable key={ALL} title="All sign-offs" startLabel="+ New sign-off" startHref="/signoffs/new" defaultSort="progress" />
      ) : (
        <SignoffTable
          key={active}
          typeId={active}
          title={types.find((t) => t.id === active)?.name ?? ""}
          startLabel={`+ Start ${types.find((t) => t.id === active)?.name ?? ""}`}
          startHref={`/signoffs/new?typeId=${encodeURIComponent(active)}`}
          defaultSort="high"
        />
      )}
    </div>
  );
}
