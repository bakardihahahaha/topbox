import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { PartUsageLine } from "@biosite-signoff/shared";
import { getJson, sendJson } from "../lib/client.js";
import { useData } from "../lib/useData.js";
import { useMe } from "../lib/meContext.js";
import { confirmDialog } from "../lib/confirmDialog.js";
import { localStamp, topboxUrl } from "../lib/format.js";
import { card, chip, errorBox, errorMessage, ghost, h1, hint, infoBox, input, page, primary } from "../lib/ui.js";

// Parts used — every replaced part ticked on a sign-off, for a period, so they can be booked out
// of stock in the stock system. An admin marks what's been booked out; the default view shows
// only what still has to be.

type Period = "thisWeek" | "lastWeek" | "thisMonth" | "lastMonth" | "custom";
type Booked = "open" | "done" | "all";

const PERIODS: { id: Period; label: string }[] = [
  { id: "thisWeek", label: "This week" },
  { id: "lastWeek", label: "Last week" },
  { id: "thisMonth", label: "This month" },
  { id: "lastMonth", label: "Last month" },
  { id: "custom", label: "From – to" },
];

const dayStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** [from, to) in local time — weeks start on Monday. */
function rangeOf(period: Period, customFrom: string, customTo: string): [Date, Date] {
  const today = dayStart(new Date());
  const monday = addDays(today, -((today.getDay() + 6) % 7));
  switch (period) {
    case "thisWeek":
      return [monday, addDays(monday, 7)];
    case "lastWeek":
      return [addDays(monday, -7), monday];
    case "thisMonth":
      return [new Date(today.getFullYear(), today.getMonth(), 1), new Date(today.getFullYear(), today.getMonth() + 1, 1)];
    case "lastMonth":
      return [new Date(today.getFullYear(), today.getMonth() - 1, 1), new Date(today.getFullYear(), today.getMonth(), 1)];
    case "custom": {
      const from = customFrom ? new Date(`${customFrom}T00:00`) : addDays(today, -30);
      const to = customTo ? addDays(new Date(`${customTo}T00:00`), 1) : addDays(today, 1);
      return [from, to];
    }
  }
}

const csvCell = (v: string | number) => (typeof v === "number" ? String(v) : `"${v.replace(/"/g, '""')}"`);

export function PartsUsagePage() {
  const me = useMe();
  const isAdmin = me.role === "admin";
  const [period, setPeriod] = useState<Period>("thisWeek");
  const [customFrom, setCustomFrom] = useState(() => ymd(addDays(new Date(), -30)));
  const [customTo, setCustomTo] = useState(() => ymd(new Date()));
  const [booked, setBooked] = useState<Booked>("open");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  const [from, to] = rangeOf(period, customFrom, customTo);
  const usage = useData<PartUsageLine[]>(
    () => getJson(`/api/parts-usage?from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`),
    [from.getTime(), to.getTime(), reload],
  );

  // "To book" = what changed since the last booking (negative = back to stock).
  const toBook = (l: PartUsageLine) => l.qty - l.bookedOutQty;
  const lines = useMemo(
    () => (usage.data ?? []).filter((l) => (booked === "all" ? !l.removed || toBook(l) !== 0 : booked === "open" ? toBook(l) !== 0 : Boolean(l.bookedOutAt) && toBook(l) === 0)),
    [usage.data, booked],
  );
  // The open view counts what's still to book; the others what was used.
  const shownQty = (l: PartUsageLine) => (booked === "open" ? toBook(l) : l.qty);

  // One row per part: total quantity and on how many TopBoxes.
  const summary = useMemo(() => {
    const byPart = new Map<string, { partNumber: string; name: string; qty: number; boxes: Set<string> }>();
    for (const l of lines) {
      const key = l.partId || l.partNumber;
      const row = byPart.get(key) ?? { partNumber: l.partNumber, name: l.name, qty: 0, boxes: new Set<string>() };
      row.qty += shownQty(l);
      row.boxes.add(l.serialNumber.toUpperCase());
      byPart.set(key, row);
    }
    return [...byPart.values()].filter((r) => r.qty !== 0 || booked !== "open").sort((a, b) => a.partNumber.localeCompare(b.partNumber, undefined, { numeric: true }));
  }, [lines, booked]);
  const totalQty = summary.reduce((n, r) => n + r.qty, 0);
  const toOut = summary.reduce((n, r) => n + Math.max(0, r.qty), 0);
  const toReturn = summary.reduce((n, r) => n + Math.max(0, -r.qty), 0);

  function downloadCsv() {
    const rows: (string | number)[][] = [
      [`Parts used ${ymd(from)} to ${ymd(addDays(to, -1))}`],
      [],
      ["Part No.", "Name", booked === "open" ? "To book (negative = return to stock)" : "Qty", "TopBoxes"],
      ...summary.map((r) => [r.partNumber, r.name, r.qty, r.boxes.size]),
      ["Total", "", totalQty, ""],
      [],
      ["Date", "TopBox", "Type", "Part No.", "Name", booked === "open" ? "To book" : "Qty", "Note", "Booked out"],
      ...lines.map((l) => [localStamp(l.recordedAt), l.serialNumber, l.typeName, l.partNumber, l.name, shownQty(l), l.removed ? `unticked after booking${l.note ? ` — ${l.note}` : ""}` : l.note, l.bookedOutAt ? `${localStamp(l.bookedOutAt)} (${l.bookedOutQty})` : ""]),
    ];
    const csv = "﻿" + rows.map((r) => r.map(csvCell).join(",")).join("\r\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    a.download = `Parts used ${ymd(from)} to ${ymd(addDays(to, -1))}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  async function markBooked(ids: string[], value: boolean) {
    if (ids.length === 0) return;
    const what = `${ids.length} line${ids.length === 1 ? "" : "s"}`;
    if (!(await confirmDialog(value ? `Mark ${what} as booked out of stock?` : `Mark ${what} as NOT booked out again?`, { confirmLabel: value ? "Booked out" : "Undo" }))) return;
    setBusy(true);
    setError(null);
    try {
      await sendJson("POST", "/api/parts-usage/booked-out", { lineIds: ids, booked: value });
      setSelected(new Set());
      setReload((n) => n + 1);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const segment = (on: boolean) => ({
    height: 48,
    padding: "0 16px",
    borderRadius: "var(--radius-control)",
    border: `1px solid ${on ? "var(--accent)" : "var(--border)"}`,
    background: on ? "var(--accent-wash)" : "transparent",
    color: on ? "var(--accent)" : "var(--text-2)",
    fontWeight: 700,
    fontSize: 14,
    cursor: "pointer",
  });
  const th = { textAlign: "left" as const, padding: "8px 10px", fontSize: 11, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase" as const, color: "var(--text-3)", borderBottom: "1px solid var(--border)" };
  const td = { padding: "8px 10px", borderBottom: "1px solid var(--border-soft)", fontSize: 13.5, verticalAlign: "top" as const };
  const selectedIds = lines.filter((l) => selected.has(l.lineId)).map((l) => l.lineId);

  return (
    <div style={page}>
      <h1 style={h1}>Parts used</h1>
      <p style={hint}>Every part ticked as replaced on a sign-off, for booking them out of stock. {isAdmin ? "Mark lines as booked out once they're done — the default view shows only what's still to book." : "An admin marks what has been booked out."}</p>

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
        {PERIODS.map((p) => (
          <button key={p.id} style={segment(period === p.id)} onClick={() => setPeriod(p.id)}>
            {p.label}
          </button>
        ))}
      </div>
      {period === "custom" && (
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 10 }}>
          <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} style={{ ...input, width: "auto" }} aria-label="From" />
          <span style={{ color: "var(--text-3)" }}>to</span>
          <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} style={{ ...input, width: "auto" }} aria-label="To" />
        </div>
      )}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 14, alignItems: "center" }}>
        <button style={segment(booked === "open")} onClick={() => setBooked("open")}>
          Not booked out
        </button>
        <button style={segment(booked === "done")} onClick={() => setBooked("done")}>
          Booked out
        </button>
        <button style={segment(booked === "all")} onClick={() => setBooked("all")}>
          All
        </button>
        <span className="mono" style={{ fontSize: 12, color: "var(--text-3)", marginLeft: 6 }}>
          {localStamp(from.toISOString()).slice(0, 10)} – {localStamp(addDays(to, -1).toISOString()).slice(0, 10)}
        </span>
      </div>

      {(usage.error || error) && <div style={errorBox}>{error ?? usage.error}</div>}
      {!usage.data && !usage.error && <div style={{ color: "var(--text-3)", fontSize: 13 }}>Loading…</div>}

      {usage.data && (
        <>
          {/* Summary per part */}
          <div style={{ ...card, marginBottom: 12, padding: 0, overflowX: "auto" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, padding: "12px 14px", flexWrap: "wrap" }}>
              <div style={{ fontWeight: 700 }}>
                {booked === "open" ? (
                  <>
                    To book out — {toOut} part{toOut === 1 ? "" : "s"}
                    {toReturn > 0 && <span style={{ color: "var(--danger)" }}> · {toReturn} to return to stock</span>}
                  </>
                ) : (
                  <>Used — {totalQty} part{totalQty === 1 ? "" : "s"}</>
                )}
              </div>
              <button style={ghost} onClick={downloadCsv} disabled={lines.length === 0}>
                Download CSV (Excel)
              </button>
            </div>
            {summary.length === 0 ? (
              <div style={{ padding: "0 14px 14px", color: "var(--text-4)", fontSize: 13 }}>{booked === "open" ? "Nothing left to book out for this period." : "No parts for this period."}</div>
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 420 }}>
                <thead>
                  <tr>
                    <th style={th}>Part No.</th>
                    <th style={th}>Name</th>
                    <th style={{ ...th, textAlign: "right" }}>{booked === "open" ? "To book" : "Qty"}</th>
                    <th style={{ ...th, textAlign: "right" }}>TopBoxes</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.map((r) => (
                    <tr key={r.partNumber + r.name}>
                      <td style={{ ...td, fontWeight: 700 }} className="mono">
                        {r.partNumber}
                      </td>
                      <td style={td}>{r.name}</td>
                      <td style={{ ...td, textAlign: "right", fontWeight: 700, fontSize: 16, color: r.qty < 0 ? "var(--danger)" : undefined }}>
                        {r.qty}
                        {r.qty < 0 && <div style={{ fontSize: 11, fontWeight: 400 }}>return to stock</div>}
                      </td>
                      <td style={{ ...td, textAlign: "right" }}>{r.boxes.size}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Every line */}
          {lines.length > 0 && (
            <div style={{ ...card, padding: 0, overflowX: "auto" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, padding: "12px 14px", flexWrap: "wrap" }}>
                <div style={{ fontWeight: 700 }}>By TopBox ({lines.length})</div>
                {isAdmin && (
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    {selectedIds.length > 0 ? (
                      <>
                        <button style={primary} disabled={busy} onClick={() => void markBooked(selectedIds.filter((id) => { const l = lines.find((x) => x.lineId === id); return l && toBook(l) !== 0; }), true)}>
                          Mark {selectedIds.length} as booked out
                        </button>
                        <button style={ghost} disabled={busy} onClick={() => void markBooked(selectedIds.filter((id) => Boolean(lines.find((l) => l.lineId === id)?.bookedOutAt)), false)}>
                          Undo
                        </button>
                      </>
                    ) : (
                      booked !== "done" && (
                        <button style={primary} disabled={busy} onClick={() => void markBooked(lines.filter((l) => toBook(l) !== 0).map((l) => l.lineId), true)}>
                          Mark all shown as booked out
                        </button>
                      )
                    )}
                  </div>
                )}
              </div>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 640 }}>
                <thead>
                  <tr>
                    {isAdmin && (
                      <th style={{ ...th, width: 40 }}>
                        <input
                          type="checkbox"
                          aria-label="Select all"
                          checked={lines.length > 0 && selectedIds.length === lines.length}
                          onChange={(e) => setSelected(e.target.checked ? new Set(lines.map((l) => l.lineId)) : new Set())}
                          style={{ width: 22, height: 22, accentColor: "var(--accent)" }}
                        />
                      </th>
                    )}
                    <th style={th}>Date</th>
                    <th style={th}>TopBox</th>
                    <th style={th}>Part</th>
                    <th style={{ ...th, textAlign: "right" }}>{booked === "open" ? "To book" : "Qty"}</th>
                    <th style={th}>Booked out</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l) => (
                    <tr key={l.lineId}>
                      {isAdmin && (
                        <td style={td}>
                          <input
                            type="checkbox"
                            aria-label={`Select ${l.serialNumber} ${l.partNumber}`}
                            checked={selected.has(l.lineId)}
                            onChange={() =>
                              setSelected((s) => {
                                const next = new Set(s);
                                if (next.has(l.lineId)) next.delete(l.lineId);
                                else next.add(l.lineId);
                                return next;
                              })
                            }
                            style={{ width: 22, height: 22, accentColor: "var(--accent)" }}
                          />
                        </td>
                      )}
                      <td style={{ ...td, whiteSpace: "nowrap" }} className="mono">
                        {localStamp(l.recordedAt).slice(0, 10)}
                      </td>
                      <td style={td}>
                        <Link to={topboxUrl(l.serialNumber, l.signoffId)} className="mono" style={{ color: "var(--accent)", fontWeight: 700, textDecoration: "none" }}>
                          {l.serialNumber}
                        </Link>
                        <div style={{ fontSize: 11.5, color: "var(--text-3)" }}>
                          {l.typeName}
                          {l.status !== "complete" ? " · in progress" : ""}
                        </div>
                      </td>
                      <td style={td}>
                        <span className="mono" style={{ fontWeight: 700 }}>
                          {l.partNumber}
                        </span>{" "}
                        {l.name}
                        {l.note && <div style={{ fontSize: 11.5, color: "var(--text-3)" }}>{l.note}</div>}
                        {l.removed && <div style={{ fontSize: 11.5, color: "var(--danger)" }}>unticked after it was booked out</div>}
                      </td>
                      <td style={{ ...td, textAlign: "right", fontWeight: 700, color: shownQty(l) < 0 ? "var(--danger)" : undefined }}>
                        {shownQty(l)}
                        {booked === "open" && l.bookedOutAt && <div style={{ fontSize: 11, fontWeight: 400, color: "var(--text-3)" }}>now {l.qty}, booked {l.bookedOutQty}</div>}
                      </td>
                      <td style={td}>
                        {l.bookedOutAt ? (
                          <span style={chip("accent")}>
                            {localStamp(l.bookedOutAt).slice(0, 10)} · {l.bookedOutQty}
                          </span>
                        ) : (
                          <span style={{ color: "var(--text-4)" }}>—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {booked === "open" && lines.length > 0 && (
            <div style={{ ...infoBox, marginTop: 12 }}>If a quantity is changed after booking, only the difference comes back here; a part unticked after booking shows as a negative number — return it to stock.</div>
          )}
        </>
      )}
    </div>
  );
}
