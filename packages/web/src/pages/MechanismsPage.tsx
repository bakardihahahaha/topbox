import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { MechanismSummary } from "@biosite-signoff/shared";
import { listMechanisms } from "../lib/api.js";
import { useData } from "../lib/useData.js";
import { daysBetween, localStamp, stamp, topboxUrl } from "../lib/format.js";
import { card, chip, errorBox, h1, hint, input, page } from "../lib/ui.js";

/** Every mechanism (serial number) and where it is now: in the workshop or out at a client. */
export function MechanismsPage() {
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);
  const list = useData<MechanismSummary[]>(() => listMechanisms(debounced || undefined), [debounced]);
  const now = new Date();

  return (
    <div style={page}>
      <h1 style={h1}>Mechanisms</h1>
      <p style={hint}>Each serial number with all its visits: when it arrived, when each check was done and when it left again. Tap one for its full history.</p>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search serial number" style={{ ...input, height: 52, fontSize: 16, marginBottom: 12 }} />
      {list.error && <div style={errorBox}>{list.error}</div>}
      {list.data?.length === 0 && <div style={{ color: "var(--text-4)", fontSize: 13 }}>No mechanisms found.</div>}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {list.data?.map((m) => (
          <Link
            key={m.serialNumber}
            to={topboxUrl(m.serialNumber)}
            style={{ ...card, color: "inherit", textDecoration: "none", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap", padding: 16 }}
          >
            <div>
              <div className="mono" style={{ fontSize: 20, fontWeight: 700 }}>
                {m.serialNumber}
              </div>
              <div style={{ fontSize: 12.5, color: "var(--text-3)", marginTop: 4 }}>
                {m.visits} visit{m.visits === 1 ? "" : "s"} · last arrived {localStamp(m.last.arrivedAt)} · {m.last.typeName}
              </div>
            </div>
            {m.atClient ? (
              <span style={chip("accent")}>
                At client · left {stamp(m.last.departedAt)}
                {m.last.departedAt ? ` (${daysBetween(m.last.departedAt.replace(" ", "T"), now)} d)` : ""}
              </span>
            ) : (
              <span style={chip("warn")}>In workshop · {m.last.firstCheckAt ? "1st check done" : "waiting for 1st check"}</span>
            )}
          </Link>
        ))}
      </div>
    </div>
  );
}
