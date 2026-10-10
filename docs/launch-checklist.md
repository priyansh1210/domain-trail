# Launch checklist

Work through this in order before announcing the site (spec 017 FR-INF-011, spec 013 FR-PRIV-014, roadmap phase 1
exit). Each line says how to check it. Details of each step are in `docs/setup.md` and the `tasks/` files.

## 1. Accounts and access
- [ ] Two-factor sign-in on GitHub, Vercel, Supabase, Upstash, Cloudflare, Resend, Sentry, Porkbun, Google Cloud
      (each dashboard's security page shows it on). Recovery codes stored offline.
- [ ] GitHub: `main` protected; environments `production` (you as reviewer) and `jobs` (main only); secret scanning
      and push protection on.

## 2. Code merged
- [ ] Pull requests for `m5-freshness`, `m5b-accounts`, `m6-launch` merged (in that order); all checks green.
- [ ] **migrate** workflow approved after each merge that changed `supabase/migrations/`.

## 3. Data jobs (tasks/M5-freshness.md G1–G6)
- [ ] `jobs` environment has `SUPABASE_DB_URL` (+ optional `RESEND_API_KEY`, `OWNER_ALERT_EMAIL`).
- [ ] Repository variable `BACKUP_AGE_PUBLIC_KEY`; private key stored offline.
- [ ] Every daily job ran once by hand and then 7 days in a row on schedule (Actions shows green).
- [ ] `/status`: every dataset "Up to date"; `/api/health` shows `"pricesSource":"database"`.
- [ ] One backup restored on your PC (`docs/runbooks/restore-db.md`).

## 4. Live mode and sign-in (tasks/M5b-accounts.md H1–H4, M4 I2)
- [ ] Turnstile site + Upstash database created; keys in Vercel; Supabase CAPTCHA uses the Turnstile secret.
- [ ] Google and GitHub sign-in configured in Supabase; anonymous sign-ins on; Site URL and redirect URL set.
- [ ] Vercel: `MOCK_EXTERNALS=0`, all secrets from `.env.example` that live mode needs; `MOCK_SIGN_IN` not set.
- [ ] `/api/health` shows `"mode":"live"` and `"ok":true`.
- [ ] You signed in once; `OWNER_USER_ID` set; `/ops` and `/ops/saved` open for you and show "not found" in a
      private window.

## 5. Quality checks on the live site
- [ ] A search from a phone and a computer: chips within 2 s, priced results in sections, Buy links work.
- [ ] Save a search and star a name while signed out; sign in; both are still there.
- [ ] Contact form message arrives on `/ops`.
- [ ] Availability accuracy check run (M4 H1, needs the Porkbun keys): "available" right ≥ 97 %.
- [ ] Decision model: decided whether to stay on the backup rules or add a small Jev credit (your decision).

## 6. Monitoring (tasks/M6-launch.md H1–H3)
- [ ] `SENTRY_DSN` set; a test error shows up in Sentry without personal data.
- [ ] UptimeRobot monitors for `/` and `/api/health` (5 minutes, e-mail alerts).
- [ ] `NEXT_PUBLIC_CF_ANALYTICS_TOKEN` set; Cloudflare shows page views; still no cookies on the home page.

## 7. Policies and people
- [ ] Read `/privacy` and `/terms`; decide on a legal review (paid; recommended).
- [ ] Incident runbook read once as a tabletop exercise (`docs/runbooks/incident.md`).
- [ ] ASVS level 1 checklist reviewed (`docs/security/asvs-l1.md`).
- [ ] Monthly: read the usage report e-mail / `quality_reports`; check the Vercel and Supabase usage pages.
