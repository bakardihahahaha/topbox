import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { checkDoneAt, departedAt, typeNameOf, type Signoff } from "@biosite-signoff/shared";
import { downloadPdf } from "../lib/pdfLazy.js";
import { getVisits } from "../lib/api.js";
import { useData } from "../lib/useData.js";
import { signStamp, useShowSignTime } from "../lib/documentSettings.js";
import { SignoffPage } from "./SignoffPage.js";
import { useMe } from "../lib/meContext.js";
import { card, chip, errorBox, ghost, h1, page, primary } from "../lib/ui.js";

/**
 * The TopBox page — topbox.duckdns.org/signoff/<serial number>. On top: the checklist of the
 * selected visit (the current one by default), where the checks are done. Below: the whole
 * rotation of that mechanism — every visit's arrival, every check (however many the checklist
 * has) with date, time and who, and the departure — oldest to newest, again and again.
 * `?id=<sign-off id>` picks a visit (also one created offline and not synced yet).
 */
export function MechanismHistoryPage() {
  const { serial = "" } = useParams();
  const me = useMe();
  const showTime = useShowSignTime();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const visits = useData<Signoff[]>(() => getVisits(serial), [serial]);
  const list = visits.data ?? [];
  const latest = list[list.length - 1];
  const selectedId = params.get("id") ?? latest?.id ?? null;
  const inWorkshop = latest && !departedAt(latest);

  const startNewVisit = () =>
    navigate(
      // No type passed on: a returning TopBox defaults to Service on the New sign-off screen.
      `/signoffs/new?serial=${encodeURIComponent(latest?.serialNumber ?? serial)}` + (latest ? `&templateId=${encodeURIComponent(latest.templateId)}` : ""),
    );

  return (
    <div style={page}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
        <div>
          <h1 style={{ ...h1, fontSize: 26 }} className="mono">
            {latest?.serialNumber ?? serial}
          </h1>
          <div style={{ fontSize: 13, color: "var(--text-3)" }}>
            {list.length} visit{list.length === 1 ? "" : "s"}
            {latest && (inWorkshop ? " · latest in progress" : " · latest complete")}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {list.length > 0 && (
            <button style={{ ...ghost, height: 56, fontSize: 14 }} onClick={() => void downloadPdf(list)} title="Every visit of this TopBox, oldest first">
              PDF — all {list.length} visit{list.length === 1 ? "" : "s"}
            </button>
          )}
          {(!latest || !inWorkshop) && visits.data && me.role !== "viewer" && me.canStart !== false && (
            <button style={{ ...primary, height: 56, fontSize: 15 }} onClick={startNewVisit}>
              {latest ? "Mechanism is back — start new visit" : "Start first sign-off"}
            </button>
          )}
        </div>
      </div>
      {visits.error && !selectedId && <div style={errorBox}>{visits.error}</div>}

      {/* Visit picker */}
      {list.length > 1 && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
          {list.map((v, i) => {
            const on = v.id === selectedId;
            // Earlier visits are history — shown greyed with a lock (view + PDF only for operators).
            const old = i < list.length - 1;
            return (
              <button
                key={v.id}
                onClick={() => setParams({ id: v.id }, { replace: true })}
                title={old ? "Earlier visit — view only" : undefined}
                style={{
                  height: 44,
                  padding: "0 14px",
                  borderRadius: "var(--radius-control)",
                  border: `1px solid ${on ? (old ? "var(--text-3)" : "var(--accent)") : "var(--border)"}`,
                  background: on ? (old ? "var(--surface-alt)" : "var(--accent-wash)") : "transparent",
                  color: on ? (old ? "var(--text-2)" : "var(--accent)") : old ? "var(--text-4)" : "var(--text-2)",
                  fontWeight: 700,
                  fontSize: 13,
                  cursor: "pointer",
                }}
              >
                {old ? "🔒 " : ""}Visit {i + 1}
                {i === list.length - 1 ? (inWorkshop ? " · now" : " · latest") : ""}
              </button>
            );
          })}
        </div>
      )}

      {/* The checklist of the selected visit */}
      {selectedId && <SignoffPage key={selectedId} signoffId={selectedId} embedded earlierVisit={list.findIndex((v) => v.id === selectedId) < list.length - 1 && list.some((v) => v.id === selectedId)} />}

      {/* Full rotation history */}
      {list.length > 0 && (
        <>
          <h2 style={{ fontSize: 18, fontWeight: 700, margin: "28px 0 10px" }}>History</h2>
          <div style={{ display: "flex", flexDirection: "column-reverse", gap: 10 }}>
            {list.map((v, i) => {
              const left = departedAt(v);
              return (
                <Link key={v.id} to={`?id=${v.id}`} replace style={{ ...card, color: "inherit", textDecoration: "none", padding: 16, borderColor: v.id === selectedId ? "var(--accent)" : "var(--border-soft)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
                    <div style={{ fontWeight: 700, fontSize: 16 }}>
                      Visit {i + 1} · {typeNameOf(v)}{" "}
                      <span className="mono" style={{ fontSize: 12, color: "var(--text-3)", fontWeight: 400 }}>
                        {v.serialNumber}
                      </span>
                    </div>
                    {left ? <span style={chip("accent")}>Complete</span> : <span style={chip("warn")}>In progress</span>}
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 8 }}>
                    {v.template.checks.map((c) => {
                      const done = checkDoneAt(v, c.id);
                      return <Step key={c.id} label={c.label} value={done ? signStamp(done.at, showTime) : "not done"} sub={done?.by} muted={!done} />;
                    })}
                  </div>
                </Link>
              );
            })}
          </div>
        </>
      )}
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
