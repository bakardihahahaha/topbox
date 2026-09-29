# Biosite Sign-off

Digital version of the paper mechanism checklists (e.g. **PA-DOC-189 "Mechanism Checklist"**):
define a checklist template once, then operators tick it on a phone/tablet/PC, sign each check
column on screen, record replaced parts on service jobs, and print a PDF that looks like the paper
original. Same team, same look and conventions as [Decom](https://github.com/bakardihahahaha/decom) —
its theme tokens, sign-in screen, sync dot and offline queue are reused directly.

Deployed at `https://topbox.duckdns.org` (Synology, see `docs/deployment.md`). CI:
`.github/workflows/ci.yml` — tests on every push, publishes `ghcr.io/bakardihahahaha/topbox-server`
from `main`.

## What it does

- **Sign-in**: every user is a tile on the first screen — tap your name, type your PIN (4–8
  digits) on the keypad. Admins create users with a PIN (or a random one) in Setup → Users.
- **Document** (Setup → Document, admin): logo (image upload or two-tone text), company name,
  address block, footer line and the "Document Identifier:" label printed on every PDF page.
- **Templates** (Setup → Templates, admin): title, document reference/id, "Serial Number" and "Item"
  headings, any number of **items** (plus **section** headings like "Security red paint on:", bold
  and indented rows; ＋ inserts a new row right below any row), a **number of checks** field
  (1st, 2nd, 3rd … up to 6, each column renamable; PA-DOC-189 uses 2), an optional
  **"Sign and date here"** row, an optional "each check signed by a different person" rule, and the
  list of **parts that may be replaced** on a service. "Preview PDF" shows the result instantly.
  The PA-DOC-189 checklist is seeded on a fresh install.
- **Parts** (Setup → Parts, admin): predefined replaceable parts (part number, name, description).
  Operators never type parts — they only tick them.
- **Sign-offs**: pick a template, choose **New** (check only) or **Service** (repair — replaced
  parts section appears), enter the serial number. Tap a box to cycle ✓ / ✗ / N/A; "✓ all" fills a
  column. When a column is complete its **Sign** button unlocks: the signature (drawn on screen) and
  date land **in that check column only**, and the column locks. Removing a signature (signer or
  admin) unlocks it again. Each sign-off freezes a copy of its template, so editing a template never
  changes records already started.
- **PDF**: generated **in the browser on the user's own device** (jsPDF) — the NAS never renders
  anything. Single sign-off from its screen, or tick several on the list and "Generate PDF": they are
  stacked like the paper form (two standard mechanism checklists per A4 page).

## Architecture

```
browser (PWA)  ──HTTPS──>  DSM reverse proxy  ──>  topbox-server (Fastify, Docker on the NAS)
   │  offline queue (IndexedDB)                         │
   │  jsPDF — PDFs made on the device                   ├── SQLite file on the NAS  ← source of truth, all reads/writes
   └  SSE live refresh                                  └── outbox ──(background)──> Google Sheet  ← backup mirror
```

### Database: NAS first, Google Sheets as mirror

- Every read and write goes to a single **SQLite file on the NAS** (`docker/data/signoff.db`) — no
  network hop, so the app is fast.
- Every write also records `(table, row id)` in a `mirror_outbox` table **in the same transaction**
  (transactional outbox). A background worker (`mirror/MirrorService.ts`, every 15 s) copies the
  current version of those rows to a Google Sheet — one tab per table, header row = column names —
  and only then clears them from the outbox. Users never wait on Google; if Google is down or over
  quota the outbox simply waits. A crash can't lose a change.
- Rows are never physically deleted (`deleted_at`), so the mirror is a pure upsert-by-id.
- **Restore** (Setup → Backup): on a fresh NAS database, pulls every tab back in. PINs are never
  written to the sheet — restored users come back locked and need a reset.
- ~50 saves/day is far below any Google quota; the mirror batches whatever is pending into a couple
  of calls per tab.

### Swapping the database engine

The server only knows the `Store` interface (`packages/server/src/store/Store.ts`) — typed,
async repositories (`users`, `sessions`, `parts`, `templates`, `signoffs`, `outbox`, …) plus a
generic all-strings row API (`tables.readRows/importRows`) over the table list in
`store/schema.ts`. `store/sqlite/SqliteStore.ts` is the only SQLite-aware code. To move to Postgres,
MySQL, etc.:

1. Implement `Store` in a new class (the SQLite one is the reference, ~600 lines).
2. Change the one `new SqliteStore(...)` line in `main.ts`.
3. Point `test/*.test.ts`' `setup()` at the new class — the whole suite is written against the
   interface, including a round-trip of every table through `readRows/importRows`.
4. Migrate data: `readRows(table)` from the old store → `importRows(table, rows)` into the new one,
   table by table in `TABLES` order (or restore from the Google Sheet mirror).

### Google quota handling (the "busy" path)

1. **Read cache** — `mirror/SheetTable.ts` keeps each tab's last read in memory for 10 s; concurrent
   readers share one request; any write to that tab drops the cache immediately (even on failure),
   so nobody ever sees stale data while repeat reads stop costing quota.
2. **One global error translator** — `app.ts`: a Google 429 (or a momentarily locked SQLite file)
   becomes **`503` + `{ error: "RATE_LIMITED" }` + `retry-after: 30`**, never Google's raw text.
   Everything else stays what it is: `HttpError` 400/403/404/409 = a real rejection, anything
   unknown = 500.
3. **Client queue** — `web/src/lib/offlineQueue.ts`: a write that fails with no connectivity **or
   exactly `503 + RATE_LIMITED`** stays in the IndexedDB queue and retries by itself after
   `retry-after`; **any other error is shown immediately and never retried**, so a real bug can't
   hide in an endless retry loop.
4. **Sync dot** — the existing decom `SavingIndicator` (dot + bar) shows "syncing / N pending"; the
   user sees "saving", never an error, for the busy case.

All client ids (sign-off, part line, part, template) are generated in the browser, so replaying any
queued write is idempotent on the server.

### Security

- PIN sign-in (bcrypt-hashed), with layered brute-force protection (`services/auth.ts`):
  - **3 wrong PINs → account locked for 5 minutes** (the tile shows a countdown);
  - **5 such lockouts in a row → locked until an admin unlocks it** (a bot waiting out the 5 minutes
    gets ~15 guesses in total, not thousands);
  - **per-IP guard across all accounts**: 10 wrong PINs from one IP in 15 min → that IP is blocked
    for 15 min (stops a bot cycling through the public name list);
  - every wrong PIN is answered after a 1 s delay; the login route is rate limited to 10/min per IP;
  - the public name list shows names only (no roles), and hard-locked accounts aren't listed.
- **One network (IP) per account** (Setup → Security, on by default): a session only works from the
  IP it signed in from; signing in from a second IP is refused while a session is live on the first
  (checked only after the PIN is correct). A token used from another IP is killed at once.
  Logout ends the session server-side; idle timeout (default 30 min) ends forgotten ones; admins can
  "End sessions" per user.
- Audit log of every sign-in (including blocked ones, with IP) and every change.

## Layout

```
packages/
  shared/  domain types (Template, Signoff, Part, …) + status helpers — used by server and web
  server/  Fastify API
           store/      Store interface, engine-neutral schema, SQLite implementation
           mirror/     Sheets REST client (+ in-memory fake), SheetTable (read cache), MirrorService
           services/   auth (single-IP sessions), catalog (templates/parts), signoffs (rules)
           routes/     HTTP API + SSE
  web/     React + Vite PWA — decom's theme/tokens; pdf.ts is the client-side PDF generator
docker/    Dockerfile, docker-compose.yml, deploy.sh
docs/      deployment.md — Synology + DuckDNS (topbox.duckdns.org) step by step
```

## Development

```bash
npm install
npm test                 # server test suite (auth/IP rules, sign-off rules, mirror, cache, 429 → 503)
npm run typecheck
FAKE_SHEETS=true npm run dev:server   # :8080, in-memory fake Google Sheet; prints the admin PIN
npm run dev:web                       # :5175, proxies /api to :8080
```

| Env var | Default | |
|---|---|---|
| `PORT` | `8080` | |
| `DB_PATH` | `./data/signoff.db` | the SQLite database file |
| `GOOGLE_SERVICE_ACCOUNT_JSON_PATH` | – | enables the Google Sheets mirror |
| `SPREADSHEET_ID` | – | initial backup sheet (can be set/changed in Setup → Backup) |
| `FAKE_SHEETS` | – | `true` = in-memory fake sheet (dev only) |
| `TRUST_PROXY` | – | `true` behind DSM's reverse proxy (real client IPs) |
| `ADMIN_NAME` / `ADMIN_PIN` | `Administrator` / random 6 digits | first admin on an empty database (set in docker-compose.yml) |
| `ADMIN_RESET` | `no` | `yes` = on start, give `ADMIN_NAME` the `ADMIN_PIN`, unlock it, make it admin (recovery) |
| `WEB_DIST_PATH` | `./web-dist` | built PWA served by the same process |
