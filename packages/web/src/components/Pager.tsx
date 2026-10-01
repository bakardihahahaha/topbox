import { ghost } from "../lib/ui.js";

/** 100 rows per page — every long list uses the same ‹ Previous · Page 2 of 7 · Next › bar. */
export const PAGE_SIZE = 100;

export function pageOf<T>(items: T[], page: number): T[] {
  return items.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
}

export function Pager({ page, total, onPage }: { page: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  if (pages <= 1) return null;
  const from = page * PAGE_SIZE + 1;
  const to = Math.min(total, (page + 1) * PAGE_SIZE);
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, margin: "12px 0" }}>
      <button style={{ ...ghost, height: 52, minWidth: 130 }} disabled={page === 0} onClick={() => onPage(page - 1)}>
        ‹ Previous
      </button>
      <span style={{ fontSize: 13.5, color: "var(--text-2)", minWidth: 170, textAlign: "center" }}>
        Page {page + 1} of {pages} · {from}–{to} of {total}
      </span>
      <button style={{ ...ghost, height: 52, minWidth: 130 }} disabled={page >= pages - 1} onClick={() => onPage(page + 1)}>
        Next ›
      </button>
    </div>
  );
}
