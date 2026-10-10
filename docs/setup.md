# Setup guide

| Field | Value |
|---|---|
| Implements | spec 017 FR-INF-006, FR-INF-011, FR-INF-013 |
| Last updated | 2026-10-10 |

Part A runs the site on your own computer with fake ("mock") data: no accounts or keys needed.
Part B creates the free online accounts, in order, when you are ready to put the site on the internet.

---

## Part A — Run it locally (about 15 minutes)

You need:
- **Node.js 22** — https://nodejs.org (LTS installer).
- **pnpm** — after Node is installed, run `npm install -g pnpm`.
- **Git** — https://git-scm.com.
- Optional, only for the real local database: **Docker Desktop** (with WSL 2 on Windows).

```bash
pnpm install                     # downloads everything (first time takes a few minutes)
pnpm dev                         # starts the site at http://localhost:3000
```

Check it works: open http://localhost:3000/api/health. You should see `"ok":true` and `"mode":"mock"`.

Useful commands:

| Command | What it does |
|---|---|
| `pnpm test` | runs all automated tests (includes the database schema tests; no Docker needed) |
| `pnpm lint` / `pnpm typecheck` | code-quality checks |
| `pnpm check` | everything CI checks, in one go |
| `pnpm trace:check` | confirms every requirement in the specs has a traceability row |
| `pnpm build` | production build of the website |

Optional real database on your machine (needs Docker Desktop running):

```bash
pnpm exec supabase start         # local Supabase (database + sign-in), first run downloads images
pnpm exec supabase db reset      # applies every migration in supabase/migrations
```

To use local settings, copy `.env.example` to `apps/web/.env.local` and fill in what you need. Never commit
`.env` files: the repository is public.

---

## Part B — Free accounts, in this order (about 1–2 hours)

Turn on **two-factor authentication** on every account (spec 013 FR-PRIV-014). Use your own e-mail for all of
them and keep the recovery codes somewhere offline.

1. **GitHub** — the public repository is https://github.com/priyansh1210/domain-trail (created 2026-10-03; the
   code is pushed from this folder with `git push -u origin main`). In the repository settings:
   - Branches → protect `main`: require the `ci` and `security` checks, require linear history.
   - Environments → create `production` with yourself as required reviewer (needed for database migrations).
   - Code security → enable secret scanning and push protection (free on public repositories).
2. **Vercel** — sign in with GitHub → *Add New Project* → import the repository → **Root Directory: `apps/web`** →
   Deploy. The first deploy runs in mock mode; open `https://<project>.vercel.app/api/health` to confirm
   (this completes milestone M1). Live address: https://domain-trail.vercel.app (deployed 2026-10-03). Function region is already set to Mumbai (`bom1`) in `apps/web/vercel.json`.
   Add `NEXT_PUBLIC_SITE_URL=https://<project>.vercel.app` and `NEXT_PUBLIC_SITE_NAME=<name>` under
   Settings → Environment Variables.
3. **Vercel AI Gateway** — create an API key, check that the `typesafe-ai/jev` model is listed, save it as
   `AI_GATEWAY_API_KEY`.
4. **Supabase** — new project, region **South Asia (Mumbai) / ap-south-1**. Copy the project URL, anon key,
   service-role key and the pooler connection string. Authentication settings:
   - Providers: enable **Google** and **GitHub** (step 5), keep e-mail sign-up **off**.
   - Enable **anonymous sign-ins** and **manual identity linking** (signed-out saving, spec 011).
   - Attack protection: enable **CAPTCHA → Turnstile** with the secret from step 7.
   - URL configuration: Site URL = your `NEXT_PUBLIC_SITE_URL`; redirect URL = `<site>/auth/callback`.
5. **Google Cloud console** (OAuth client) and **GitHub → Developer settings → OAuth app** — paste their client
   ids and secrets into Supabase.
6. **Upstash** — free Redis database (region close to Mumbai) → REST URL and token.
7. **Cloudflare** — Turnstile site (invisible/managed) → site key + secret; Web Analytics → token.
8. **Sentry** — Next.js project → DSN.
9. **Resend** — API key for owner alerts only (`EMAIL_MODE` stays `off`; no domain needed to e-mail yourself).
10. **Porkbun** — account + API access → keys (used only by GitHub Actions). Name.com / Dynadot keys only if
    research item R-05 confirms free access.
11. **UptimeRobot** — monitors for `/` and `/api/health` every 5 minutes.
12. Put the secrets into **Vercel** (Production and Preview separately — Preview never gets the production
    service-role key) and **GitHub → Settings → Secrets and variables → Actions** (`SUPABASE_DB_URL`, etc.).
    The full list with explanations is in `.env.example`.
13. Run the **migrate** workflow (approve it in the `production` environment), then set `MOCK_EXTERNALS=0` in
    Vercel and redeploy. `/api/health` should now show `"mode":"live"`.

## Part C — Daily data jobs (milestone M5, about 20 minutes)

The jobs run on GitHub's free runners every day and write to the database. They need their own GitHub
environment, because a daily job cannot wait for your approval every morning.

1. **Apply the database changes**: Actions → **migrate** → *Run workflow* → approve it in `production`. (The only
   run so far, on 2026-10-03, failed because the database did not exist yet.)
2. **Create the `jobs` environment**: Settings → Environments → *New environment* → name `jobs`.
   - Deployment branches and tags → **Selected branches** → add `main` (other branches and forks cannot use it).
   - No required reviewer.
   - Environment secret `SUPABASE_DB_URL`: the same pooler connection string as in `production`.
3. Optional — **alert e-mails** when a job fails twice in a row (GitHub already e-mails you about every failed
   scheduled run): create a free Resend account with the address you want alerts on, make an API key, then add
   the secrets `RESEND_API_KEY` and `OWNER_ALERT_EMAIL` (that same address) to the `jobs` environment.
4. **Backups** — on your PC, install `age` (Windows: `winget install FiloSottile.age`) and run
   `age-keygen -o backup-key.txt`. Keep `backup-key.txt` offline (USB stick or password manager): it is the only
   way to open a backup. Copy the line starting with `age1…` (the public key) into Settings → Secrets and
   variables → Actions → **Variables** → `BACKUP_AGE_PUBLIC_KEY`. A public key is safe to share.
5. Optional repository **variables** (same page): `NEXT_PUBLIC_SITE_URL` and `NEXT_PUBLIC_SITE_NAME`, so data
   providers see the site address in our downloads (otherwise they see the repository address).
6. **First runs**: Actions → run each of `daily-tld-registry`, `daily-prices`, `daily-nrd`,
   `daily-free-providers`, `weekly-brand-list`, `daily-cleanup` and `weekly-backup` once (*Run workflow*). Then
   open https://domain-trail.vercel.app/status: every dataset should show "Up to date", and
   `/api/health` should show `"pricesSource":"database"` within an hour.

What runs when (UTC): extension registry 00:30 · prices 01:00 · newly registered names 02:00 · free providers
02:30 · popular sites Sunday 03:00 · clean-up 05:00 · backup Sunday 05:30 · usage report on the 1st · ranking
weight proposal on the 2nd. Runbooks for re-running jobs, restoring a backup and other chores are in
`docs/runbooks/`.

## Moving to your own domain later
Add the domain in Vercel → change `NEXT_PUBLIC_SITE_URL` → update the Supabase Site URL and redirect URL →
redeploy. No code changes (spec 000 FR-SYS-011). Buying a domain is a paid item and needs a spec change first
(constitution P1).
