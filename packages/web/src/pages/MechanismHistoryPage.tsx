import { Link, useNavigate, useParams } from "react-router-dom";
import { checkDoneAt, departedAt, typeNameOf, type Signoff } from "@biosite-signoff/shared";
import { getVisits } from "../lib/api.js";
import { useData } from "../lib/useData.js";
import { daysBetween, localStamp, stamp } from "../lib/format.js";
import { card, chip, errorBox, h1, page, primary } from "../lib/ui.js";

/** One mechanism's full rotation: arrived → 1st check → 2nd check (= left) → back again … */
export function MechanismHistoryPage() {
  const { serial = "" } = useParams();
  const navigate = useNavigate();
  const visits = useData<Signoff[]>(() => getVisits(serial), [serial]);
  const list = visits.data ?? [];
  const latest = list[list.length - 1];
  const inWorkshop = latest && !departedAt(latest);

  return (
    <div style={page}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
        <div>
          <h1 style={{ ...h1, fontSize: 24 }} className="mono">
            {serial}
          </h1>
          <div style={{ fontSize: 13, color: "var(--text-3)" }}>
            {list.length} visit{list.length === 1 ? "" : "s"}
            {latest && (inWorkshop ? " · in the workshop now" : ` · at client since ${stamp(departedAt(latest))}`)}
          </div>
        </div>
        {latest && !inWorkshop && (
          <button
            style={{ ...primary, height: 56, fontSize: 15 }}
            onClick={() => navigate(`/signoffs/new?serial=${encodeURIComponent(latest.serialNumber)}&templateId=${encodeURIComponent(latest.templateId)}&typeId=${encodeURIComponent(latest.typeId)}`)}
          >
            Mechanism is back — start new visit
          </button>
        )}
        {latest && inWorkshop && (
          <Link to={`/signoffs/${latest.id}`} style={{ ...primary, height: 56, display: "inline-flex", alignItems: "center", textDecoration: "none" }}>
            Open current visit
          </Link>
        )}
      </div>
      {visits.error && <div style={errorBox}>{visits.error}</div>}

      <div style={{ display: "flex", flexDirection: "column-reverse", gap: 10 }}>
        {list.map((v, i) => {
          const left = departedAt(v);
          const prev = list[i - 1];
          const prevLeft = prev ? departedAt(prev) : null;
          return (
            <Link key={v.id} to={`/signoffs/${v.id}`} style={{ ...card, color: "inherit", textDecoration: "none", padding: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
                <div style={{ fontWeight: 700, fontSize: 16 }}>
                  Visit {i + 1} · {typeNameOf(v)}{" "}
                  <span className="mono" style={{ fontSize: 12, color: "var(--text-3)", fontWeight: 400 }}>
                    {v.number}
                  </span>
                </div>
                {left ? <span style={chip("accent")}>Left {stamp(left)}</span> : <span style={chip("warn")}>In workshop</span>}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 8 }}>
                <Step label="Arrived" value={localStamp(v.arrivedAt)} sub={prevLeft ? `${daysBetween(prevLeft.replace(" ", "T"), new Date(v.arrivedAt))} days at client before` : undefined} />
                {v.template.checks.map((c) => {
                  const done = checkDoneAt(v, c.id);
                  return <Step key={c.id} label={c.label} value={done ? stamp(done.at) : "not done"} sub={done?.by} muted={!done} />;
                })}
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

function Step({ label, value, sub, muted }: { label: string; value: string; sub?: string; muted?: boolean }) {
  return (
    <div style={{ background: "var(--bg-deep)", borderRadius: "var(--radius-control)", padding: "8px 10px" }}>
      <div className="mono" style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".08em", color: "var(--text-3)", textTransform: "uppercase" }}>
        {label}
      </div>
      <div className="mono" style={{ fontSize: 14, fontWeight: 600, color: muted ? "var(--text-4)" : "var(--text)" }}>
        {value}
      </div>
      {sub && <div style={{ fontSize: 11.5, color: "var(--text-3)" }}>{sub}</div>}
    </div>
  );
}
