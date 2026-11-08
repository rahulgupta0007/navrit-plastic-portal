# Plastic Rate Management Portal — NAVRIT

Lightweight bilingual (English / Hindi) web app for **NAVRIT** (*Turning Waste into Value.*) to publish daily plastic purchase rates.

## Stack

- **Next.js 15** (App Router) — SEO-friendly public pages
- **SQLite** via Node built-in `node:sqlite` — single file DB, tiny footprint
- **Tailwind CSS 4** — mobile-first UI
- **Chart.js** — lightweight analytics charts
- **jose + bcryptjs** — admin session auth

Designed for **10–50 users/day**. No Redis, no Postgres, no heavy enterprise stack.

## Quick start

```bash
cp .env.example .env.local
npm install
npm run db:seed
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

**Admin:** [http://localhost:3000/admin](http://localhost:3000/admin)  
Default login (from `.env.local`): `admin` / `admin123`

**View-only user (optional):** set `READONLY_USERNAME` + `READONLY_PASSWORD` in `.env.local` / Railway Variables. That login can browse all ledgers and reports but cannot save, edit, delete, or use Backup.

## Features

### Public
- About & Contact pages remain available
- Home `/` currently redirects to admin login (internal ops app first)

### Admin (dual modes: PET / PLASTIC)
- Secure login; mode toggle isolates every ledger row
- Inventory & finance: purchases, sales, expenses, borrowings, vendor credit/advances
- Labour management: attendance (full/half/custom hours), wage vs advance, editable entries
- PET processing contractor at ₹/kg: earns on batch complete and on sale; advances/settlements sync to Accounts
- Material & profit analysis, accounts by person (Rahul / Devesh / Nitin)
- **Navi** 🌱 — cute AI assistant that reads portal ledgers for summaries/reports (optional LLM key + web research)
- Backup create / download / restore (both modes)
- Rates catalog + historical `rate_snapshots` still available under admin

### Navi (AI assistant)
- Sidebar: **Navi** → chat about cash, profit sketches, dues, stock, labour, buyers/vendors
- Data source is this portal (read-only tools). Optional internet snippets via DuckDuckGo.
- Without a key Navi still answers from a local portal brain. For full LLM chat set on Railway:
  - `NAVI_API_KEY` or `OPENAI_API_KEY` (OpenAI-compatible)
  - optional `NAVI_API_BASE`, `NAVI_MODEL` (default `gpt-4o-mini`)

### Email purchase / payment slips (Gmail / Resend)
- On **add/update purchase** and **vendor payment**, the portal builds a PDF and emails it to **Rahul, Devesh, and Nitin**:
  - `rahulnitingupta741@gmail.com`
  - `deveshemailbox@gmail.com`
  - `nitingupta212000@gmail.com`
- Extra addresses can be added with `NOTIFY_EMAILS` (comma-separated).
- Preferred on Railway: `RESEND_API_KEY` (HTTPS). Fallback: Gmail App Password.
  - `RESEND_API_KEY` / or `GMAIL_USER` + `GMAIL_APP_PASSWORD`
  - Optional `NOTIFY_EMAIL` / `NOTIFY_EMAILS`

### Verified business rules (local smoke)
- Purchase → inventory_transactions (+kg); sale → adjustment (−kg) using the same stock key
- Natural bottles stock keys: `Natural Bottles - Green|White|White Milk`; red: `Red Bottles`
- Oversell rejected; supplier credit payment cannot exceed outstanding
- PET sale labour: Contract ₹2/kg or Daily wage; PLASTIC figures stay isolated from PET
- Build uses in-memory SQLite; runtime production DB is only `/app/data/plastic-rates.db`

## Data model

| Table | Purpose |
|-------|---------|
| `categories` | PET, PP, HDPE, … (EN + HI) |
| `materials` | Plastic items under categories |
| `rate_snapshots` | One row per material **per date** (unique index) |
| `admins` | Login accounts |

DB file: `data/plastic-rates.db`

## Configure business info

Edit `.env.local`:

- `NEXT_PUBLIC_BUSINESS_NAME`
- `NEXT_PUBLIC_BUSINESS_TAGLINE`
- `NEXT_PUBLIC_PHONE`, `NEXT_PUBLIC_WHATSAPP`, `NEXT_PUBLIC_EMAIL`
- `NEXT_PUBLIC_ADDRESS`, `NEXT_PUBLIC_MAPS_EMBED_URL`
- `ADMIN_USERNAME`, `ADMIN_PASSWORD`, `AUTH_SECRET`

## Production

```bash
npm run build
npm start
```

Requires **Node.js 22+** (for built-in `node:sqlite`). Change `AUTH_SECRET` and admin password before deploying.

## Backup & safe upgrades

Your live data lives in **`data/plastic-rates.db`**. Backups go to **`data/backups/`** (admin-only, not in git, SHA-256 checksum).

| Command | What it does |
|---------|----------------|
| `npm run db:backup` | Snapshot DB now |
| `npm run db:restore:list` | List backups |
| `npm run db:restore -- <file.db>` | Restore (creates safety backup first) |
| `npm run deploy:safe` | Backup → install → build (then restart) |

**Admin UI:** `/admin/backup`

- **Export migration pack** — zip with full SQLite DB + `railway-variables.env` (secrets) + row-count manifest. Save on your laptop before changing Railway accounts.
- **Import** — upload that zip (or a raw `.db`) on the new deploy, type `RESTORE`, then redeploy/restart.
- DB snapshots — create / download / restore individual SQLite files.

### Move to a new Railway account

1. On the old site → **Backup → Export migration pack** → download zip locally.
2. New Railway project from the same GitHub repo; attach volume at `/app/data`.
3. Open `railway-variables.env` from the zip and paste into Railway → Variables (exact copy).
4. Deploy once, login, **Backup → Import** the zip (`RESTORE`), then redeploy/restart.
5. Never commit the zip or env file to git.

**Upgrade checklist**
1. `npm run db:backup` (or use Admin → Backup / Export migration pack)
2. Download a copy to your laptop
3. `git pull` (or upload new code)
4. `npm run deploy:safe`
5. Restart: `pm2 restart navrit` (or `npm start`)

Never delete `data/` on the server when deploying code.

### Railway Volume (required — prevents data loss on deploy)

SQLite lives on disk. Railway’s container filesystem is **wiped every deploy**.

The git repo includes an empty `data/` folder, so `/app/data` exists **inside the image** even with no Volume. Saving/importing there looks fine until the next deploy deletes it. The app now **detects** that and refuses ephemeral storage.

**Correct order:**
1. Service → **Settings → Volumes → Add volume**
2. Mount path: **`/app/data`** (exact) — reuse the same volume forever
3. Redeploy (app should start on the volume)
4. Only then: Admin → **Backup → Import** `navrit-migration-*.zip`
5. Redeploy once more and confirm data is still there

Optional: `NAVRIT_DATA_DIR=/app/data`. Escape hatch (not for production): `NAVRIT_ALLOW_EPHEMERAL_DB=1`.

## Hosting (low cost, easy upgrades)

This app uses **SQLite on disk**, so it needs a small VPS / cloud VM with **persistent storage** — not pure serverless (Vercel alone) unless you move the DB elsewhere.

### Recommended (simplest + cheap)

**Option A — Small VPS (~₹400–800/month)**  
Examples: Contabo, Hetzner CX22, DigitalOcean Droplet, Hostinger VPS, AWS Lightsail.

1. Create Ubuntu 22.04+ VM  
2. Install Node 22 + nginx + pm2  
3. Point domain DNS to the VM  
4. Clone repo, copy `.env.local`, seed once, run with pm2  
5. Nginx reverse-proxy to `localhost:3000` + free HTTPS (Let’s Encrypt)

```bash
# on server (after first setup)
cd /var/www/navrit
git pull
npm run deploy:safe
pm2 restart navrit
```

**Option B — Railway / Render with a volume**  
Deploy the Next.js app and attach a **persistent volume**. On Railway the app expects the DB at **`/app/data/plastic-rates.db`**, so mount the volume at **`/app/data`** (not `/data`).

#### Railway data safety (do not skip)

Live inventory, purchases, sales, and rates live only on the Railway volume. Code deploys must never wipe that file.

1. In Railway → service → **Volumes**: mount path must be `/app/data`.
2. **Never** set the start command to `npm run db:seed` or `db:seed:prod`. Seed is for first local/dev setup only. Production schema migrates additively on boot via `CREATE TABLE IF NOT EXISTS` / safe `ALTER`s.
3. Before every production deploy:
   - Open Admin → **Backup** (available in both PET and PLASTIC modes) → Create backup → Download a copy to your laptop
   - Or take a Railway volume snapshot if your plan supports it
4. Deploy code (GitHub → Railway). Build uses an in-memory SQLite (`NAVRIT_SQLITE_MEMORY=1`) and does not touch the volume.
5. After deploy: log in → confirm stock kg, recent purchases, and sale counts still match → create another backup.

Optional env overrides (only if you intentionally change the mount): `NAVRIT_DATA_DIR`, `NAVRIT_DB_PATH`. In production, if `/app/data` is missing the app **refuses to start** rather than creating a new empty DB on ephemeral disk.

**Option C — Free tier experiments**  
Oracle Cloud free ARM VM can work if you are comfortable with setup. Still use pm2 + backups.

### What not to do

- Do **not** deploy to Vercel/Netlify **without** an external DB — the filesystem is ephemeral and your rates would reset.
- Do **not** commit `.env.local` or `data/*.db` to git.
- Do **not** delete or remount the Railway volume when redeploying.
- Do **not** run seed against the production volume.

**Stock naming:** Purchases of Natural/Red bottles must include a colour variant so inventory keys match sales (`Natural Bottles - Green`, `Natural Bottles - White`, `Natural Bottles - White Milk`, `Red Bottles`). If an older purchase was saved as plain `Natural Bottles`, use **Inventory → adjustment** to move kg into the correct variant name before selling — do not delete historical purchase rows.

### Minimal server setup (pm2)

```bash
npm i -g pm2
npm run build
pm2 start npm --name navrit -- start -- -p 3000 -H 127.0.0.1
pm2 save
pm2 startup
```

Cron daily backup (optional):

```bash
0 2 * * * cd /var/www/navrit && npm run db:backup -- cron >> /var/log/navrit-backup.log 2>&1
```

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Dev server |
| `npm run build` | Production build |
| `npm start` | Run production server |
| `npm run db:seed` | Create tables + sample 30-day rates |
| `npm run db:backup` | Create DB backup |
| `npm run db:restore` | Restore from backup |
| `npm run deploy:safe` | Backup + install + build |
