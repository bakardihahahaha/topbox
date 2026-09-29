import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { SignoffSummary } from "@biosite-signoff/shared";
import { getStock } from "../lib/api.js";
import { useData } from "../lib/useData.js";
import { useSignoffTypes } from "../lib/signoffTypes.js";
import { stamp, localStamp, topboxUrl } from "../lib/format.js";
import { SignoffsListPage } from "./SignoffsListPage.js";
import { card, chip, errorBox, page, primary } from "../lib/ui.js";

// The home screen: one tab per sign-off type (Setup → Types) showing what's in stock right now —
// mechanisms with the first check done but not the last one yet. Finishing the last check makes
// a mechanism drop off (it has left). "All sign-offs" is the full searchable list.
const TAB_KEY = "biosite-signoff.home-tab";
const ALL = "__all";

export function HomePage() {
  const types = useSignoffTypes();
  const [tab, setTab] = useState<string>(() => {
    try {
      return localStorage.getItem(TAB_KEY) ?? "";
    } catch {
      return "";
    }
  });
  const active = tab === ALL || types.some((t) => t.id === tab) ? tab : (types[0]?.id ?? ALL);

  useEffect(() => {
    try {
      localStorage.setItem(TAB_KEY, active);
    } catch {
      // best-effort
    }
  }, [active]);

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
      {active === ALL ? <SignoffsListPage /> : <StockTab typeId={active} typeName={types.find((t) => t.id === active)?.name ?? ""} service={Boolean(types.find((t) => t.id === active)?.allowsParts)} />}
    </div>
  );
}

function StockTab({ typeId, typeName, service }: { typeId: string; typeName: string; service: boolean }) {
  const navigate = useNavigate();
  const stock = useData<SignoffSummary[]>(() => getStock(typeId), [typeId]);
  const items = stock.data ?? [];
  return (
    <div style={page}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 12, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 700 }}>
            {typeName} — in stock: {stock.data ? items.length : "…"}
          </div>
          <div style={{ fontSize: 12.5, color: "var(--text-3)" }}>
            First check done, waiting for the last check. {service ? "Newest first check first." : "Highest serial number first."} Once the last check is signed it leaves this list.
          </div>
        </div>
        <button style={{ ...primary, height: 52 }} onClick={() => navigate(`/signoffs/new?typeId=${encodeURIComponent(typeId)}`)}>
          + Start {typeName}
        </button>
      </div>
      {stock.error && <div style={errorBox}>{stock.error}</div>}
      {stock.data && items.length === 0 && <div style={{ color: "var(--text-4)", fontSize: 14 }}>Nothing in stock for {typeName}.</div>}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 10 }}>
        {items.map((s) => (
          <Link key={s.id} to={topboxUrl(s.serialNumber, s.id)} style={{ ...card, color: "inherit", textDecoration: "none", display: "flex", flexDirection: "column", gap: 6, padding: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline" }}>
              <span className="mono" style={{ fontSize: 22, fontWeight: 700 }}>
                {s.serialNumber}
              </span>
              <span style={chip("warn")}>{s.progress}</span>
            </div>
            <div style={{ fontSize: 13, color: "var(--text-2)" }}>
              1st check: <b>{stamp(s.firstCheckAt)}</b>
              {s.firstCheckBy ? ` · ${s.firstCheckBy}` : ""}
            </div>
            <div className="mono" style={{ fontSize: 11.5, color: "var(--text-3)" }}>
              arrived {localStamp(s.arrivedAt)} · {s.templateName}
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
