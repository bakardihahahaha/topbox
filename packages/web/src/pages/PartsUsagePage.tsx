import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { PartUsageLine } from "@biosite-signoff/shared";
import { getJson, sendJson } from "../lib/client.js";
import { useData } from "../lib/useData.js";
import { useMe } from "../lib/meContext.js";
import { confirmDialog } from "../lib/confirmDialog.js";
import { localStamp, topboxUrl } from "../lib/format.js";
import { Pager, pageOf } from "../components/Pager.js";
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


export function PartsUsagePage() {
  const me = useMe();
  // Admins and "parts" accounts book parts out (and back); everyone else only looks.
  const isAdmin = me.role === "admin" || me.role === "parts";
  const partsOnly = me.role === "parts";
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

  /** A real Excel file (.xlsx) — opens the same in Polish and English Excel (no CSV separator /
   * decimal comma / encoding surprises): sheet "Summary" per part, sheet "By TopBox" per line.
   * Quantities are numbers, dates are written as dd/mm/yyyy text. */
  async function downloadExcel() {
    const XLSX = await import("xlsx");
    const day = (iso: string) => localStamp(iso).slice(0, 10);
    const qtyHead = booked === "open" ? "To book (negative = return to stock)" : "Qty";
    const summarySheet = XLSX.utils.aoa_to_sheet([
      [`Parts used ${day(from.toISOString())} – ${day(addDays(to, -1).toISOString())}`],
      [],
      ["Part No.", "Name", qtyHead, "TopBoxes"],
      ...summary.map((r) => [r.partNumber, r.name, r.qty, r.boxes.size]),
      ["Total", "", totalQty, ""],
    ]);
    summarySheet["!cols"] = [{ wch: 16 }, { wch: 34 }, { wch: 14 }, { wch: 10 }];
    const linesSheet = XLSX.utils.aoa_to_sheet([
      ["Date", "TopBox", "Type", "Part No.", "Name", booked === "open" ? "To book" : "Qty", "Note", "Booked out", "Booked out by"],
      ...lines.map((l) => [
        day(l.recordedAt),
        l.serialNumber,
        l.typeName,
        l.partNumber,
        l.name,
        shownQty(l),
        l.signoffDeleted ? "sign-off deleted — return to stock" : l.removed ? `unticked after booking${l.note ? ` — ${l.note}` : ""}` : l.note,
        l.bookedOutAt ? day(l.bookedOutAt) : "",
        l.bookedOutAt ? l.bookedOutBy : "",
      ]),
    ]);
    linesSheet["!cols"] = [{ wch: 12 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 30 }, { wch: 9 }, { wch: 34 }, { wch: 12 }, { wch: 18 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, summarySheet, "Summary");
    XLSX.utils.book_append_sheet(wb, linesSheet, "By TopBox");
    XLSX.writeFile(wb, `Parts used ${ymd(from)} to ${ymd(addDays(to, -1))}.xlsx`);
  }

  async function markBooked(ids: string[], value: boolean) {
    if (ids.length === 0) return;
    const what = `${ids.length} line${ids.length === 1 ? "" : "s"}`;
    if (!(await confirmDialog(value ? `Mark ${what} as booked out of stock?` : `Mark ${what} as NOT booked out?`, { confirmLabel: value ? "Mark as booked out" : "Mark as NOT booked out" }))) return;
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
  // 100 lines per page; another period / view starts again at page 1.
  const [linePage, setLinePage] = useState(0);
  const viewKey = `${from.getTime()}|${to.getTime()}|${booked}`;
  const [lastViewKey, setLastViewKey] = useState(viewKey);
  if (lastViewKey !== viewKey) {
    setLastViewKey(viewKey);
    setLinePage(0);
  }
  const selectedLines = lines.filter((l) => selected.has(l.lineId));
  // Booking applies to the ticked lines, or — nothing ticked — to every line shown.
  const bookable = (selectedLines.length ? selectedLines : lines).filter((l) => toBook(l) !== 0).map((l) => l.lineId);
  const unbookable = selectedLines.filter((l) => l.bookedOutAt).map((l) => l.lineId);

  return (
    <div style={page}>
      <h1 style={h1}>Parts used</h1>
      <p style={hint}>Every part ticked as replaced on a sign-off, for booking them out of stock. {isAdmin ? "Mark lines as booked out once they're done — the default view shows only what's still to book." : "An admin or the Parts used account marks what has been booked out."}</p>

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
              <button style={ghost} onClick={() => void downloadExcel()} disabled={lines.length === 0}>
                Download Excel (.xlsx)
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
                {/* Always the same buttons in the same place (greyed when they don't apply), so ticking
                    never shifts the table. Booked out view: tick lines → "Mark … as not booked out". */}
                {isAdmin && (
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                    <span style={{ fontSize: 13, color: selectedIds.length ? "var(--text)" : "var(--text-3)" }}>{selectedIds.length} selected</span>
                    <button style={{ ...primary, height: 48, opacity: bookable.length ? 1 : 0.45 }} disabled={busy || bookable.length === 0} onClick={() => void markBooked(bookable, true)}>
                      {!selectedIds.length ? "Mark all shown as booked out" : bookable.length ? `Mark ${bookable.length} as booked out` : "Mark as booked out"}
                    </button>
                    <button style={{ ...ghost, height: 48, opacity: unbookable.length ? 1 : 0.45 }} disabled={busy || unbookable.length === 0} onClick={() => void markBooked(unbookable, false)}>
                      Mark {unbookable.length || ""} as NOT booked out
                    </button>
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
                    <th style={th}>Booked out by</th>
                  </tr>
                </thead>
                <tbody>
                  {pageOf(lines, linePage).map((l) => (
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
                        {partsOnly ? (
                          <span className="mono" style={{ fontWeight: 700 }}>
                            {l.serialNumber}
                          </span>
                        ) : (
                          <Link to={topboxUrl(l.serialNumber, l.signoffId)} className="mono" style={{ color: "var(--accent)", fontWeight: 700, textDecoration: "none" }}>
                            {l.serialNumber}
                          </Link>
                        )}
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
                        {l.removed && <div style={{ fontSize: 11.5, color: "var(--danger)" }}>{l.signoffDeleted ? "sign-off deleted — return to stock" : "unticked after it was booked out"}</div>}
                      </td>
                      <td style={{ ...td, textAlign: "right", fontWeight: 700, color: shownQty(l) < 0 ? "var(--danger)" : undefined }}>
                        {shownQty(l)}
                        {booked === "open" && l.bookedOutAt && <div style={{ fontSize: 11, fontWeight: 400, color: "var(--text-3)" }}>now {l.qty}, booked {l.bookedOutQty}</div>}
                      </td>
                      <td style={td}>
                        {l.bookedOutAt ? <span style={chip("accent")}>{localStamp(l.bookedOutAt).slice(0, 10)}</span> : <span style={{ color: "var(--text-4)" }}>—</span>}
                      </td>
                      <td style={{ ...td, whiteSpace: "nowrap" }}>{l.bookedOutAt ? l.bookedOutBy || "—" : <span style={{ color: "var(--text-4)" }}>—</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <Pager page={linePage} total={lines.length} onPage={setLinePage} />
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
