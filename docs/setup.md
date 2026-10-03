# Setup guide

| Field | Value |
|---|---|
| Implements | spec 017 FR-INF-006, FR-INF-011, FR-INF-013 |
| Last updated | 2026-10-03 |

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
   (this completes milestone M1). Function region is already set to Mumbai (`bom1`) in `apps/web/vercel.json`.
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

## Moving to your own domain later
Add the domain in Vercel → change `NEXT_PUBLIC_SITE_URL` → update the Supabase Site URL and redirect URL →
redeploy. No code changes (spec 000 FR-SYS-011). Buying a domain is a paid item and needs a spec change first
(constitution P1).
