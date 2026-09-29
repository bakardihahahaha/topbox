# Deploying to the Synology (DS225+)

Same pattern as Decom, KPI and Stock Take: one Docker container on the NAS, DuckDNS for the name,
DSM's own certificate + reverse proxy for HTTPS. This app uses **`topbox.duckdns.org`** and
container port **8084** (decom 8083, KPI 8082, Stock Take 8080).

## 1. DuckDNS → the NAS

1. The `topbox` subdomain exists on duckdns.org. **Check its IP**: it must be your home's public IP
   (the same one `stocktake.duckdns.org` shows, e.g. `80.4.118.201`). If you pressed "update ip"
   from a phone on another network (work Wi-Fi / VPN), it points there instead — fix it below.
2. **DSM → Control Panel → External Access → DDNS → Add**: provider DuckDNS, hostname
   `topbox.duckdns.org`, same DuckDNS token as the other subdomains. DSM then keeps the IP correct
   automatically.
3. Ports 80/443 are already forwarded to the NAS (shared with the other apps).

## 2. Certificate + reverse proxy

1. **DSM → Control Panel → Security → Certificate → Add → Let's Encrypt** for `topbox.duckdns.org`.
   Then **Settings** in that panel: assign this certificate to the reverse-proxy entry below.
2. **DSM → Control Panel → Login Portal → Advanced → Reverse Proxy → Create**:
   - Source: HTTPS, `topbox.duckdns.org`, port 443 (enable HSTS)
   - Destination: HTTP, `localhost`, port **8084**
   - **Custom Header → Create**:
     - `X-Forwarded-For` = `$proxy_add_x_forwarded_for`
     - `X-Real-IP` = `$remote_addr`
     - also **Create → WebSocket** (adds the Upgrade/Connection headers; harmless, keeps live
       updates snappy)

   The `X-Forwarded-For` header is what lets the app see each user's real IP — the
   one-IP-per-account rule and the login rate limit depend on it. **Check it** after the first
   sign-in: Setup → Users shows each active session's IP. If everyone shows `172.x.x.x` or
   `127.0.0.1`, the header is missing.

## 3. Google Sheets backup (service account)

Reuse the service account from Decom/KPI if you have one, or:

1. [console.cloud.google.com](https://console.cloud.google.com) → project → **APIs & Services →
   Library → Google Sheets API → Enable**.
2. **Credentials → Create credentials → Service account** → **Keys → Add key → JSON**. Keep the file
   private.
3. Create an **empty** Google Sheet (e.g. "Sign-off backup") → **Share** → paste the service
   account's e-mail → **Editor**.

## 4. Run it (Container Manager)

1. Make the image pullable once: GitHub → repo → **Packages → signoff-server → Package settings →
   Change visibility → Public**. The image is built by `.github/workflows/signoff.yml`
   (automatically on the default branch, or **Actions → Sign-off → Run workflow** from any branch).
2. File Station: create `/volume1/docker/signoff/`, copy `signoff/docker/docker-compose.yml` into it
   and the JSON key next to it as `service-account.json`.
3. **Container Manager → Project → Create** → path `/volume1/docker/signoff` → it reads the compose
   file, pulls `ghcr.io/bakardihahahaha/signoff-server:latest`, starts it.
4. Container → **Log**: copy the one-time admin PIN (or set `BOOTSTRAP_ADMIN_PIN` in the compose
   file before the first start).
5. Open `https://topbox.duckdns.org`, tap **Administrator**, enter the PIN, then:
   - **Setup → Backup**: paste the Google Sheet URL → "Use this sheet". Everything is copied over;
     the status shows "Up to date" when done.
   - **Setup → Users**: add everyone with a PIN — each person becomes a tile on the sign-in
     screen; the name is also what's printed next to their signature.
   - **Setup → Document**: company name, address, footer, logo printed on every PDF.
   - **Setup → Parts**, then **Setup → Templates**: number of checks, items, and which parts each
     template allows.

**Updates**: Container Manager → Project → signoff → **Action → Update** (or `./deploy.sh`).

## Where the data is

- `/volume1/docker/signoff/data/signoff.db` (+ `-wal`/`-shm` files) — the whole database. Include
  the folder in Hyper Backup if you use it; the Google Sheet is the off-NAS copy.
- To start from zero: stop the container, delete `data/`, start again (new admin PIN in the log).

## Disaster recovery (NAS died)

1. New NAS/disk → steps 1–4 above (the new, empty database gets a fresh admin).
2. Setup → Backup → paste the same sheet URL → **Restore from sheet…**
3. Setup → Users → **Edit name / PIN** (or **Random PIN**) for each restored (locked) user.
