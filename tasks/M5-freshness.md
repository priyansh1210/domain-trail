# Tasks — Milestone M5 · Freshness & ops

| Field | Value |
|---|---|
| Milestone | M5 (roadmap) |
| Exit criterion | 7 days of green daily jobs; the Status page shows every dataset younger than 26 hours |
| Specs | 010 (daily refresh), 012 §5.2–5.5 (retention, backups, staging), 015 (meters, alerts, status), 017 §5.5 (runbooks), 006 §5.6 (price job), 007 (free-provider job), 014 §5.2 (brand list), 009 FR-UX-011 (Status page) |
| Started | 2026-10-10 |
| Built | 2026-10-10 (owner steps G1–G6 open) |

Status: ☐ open · ◐ in progress · ☑ done · ⏸ waiting for the owner

**2026-10-10: built and tested; waiting for the owner's setup (G1–G5) and then 7 days of green runs (G6).** Nine jobs
in `jobs/`, nine workflows, the Status page and the database price source. Tests: jobs 55 (PGlite with every
migration), metrics 13, pricing +4, core +3 (brand list), web +5 unit and +8 end-to-end (52 in total, desktop and
mobile, axe). Every job also ran twice through the production database driver against a real Postgres wire-protocol
server (PGlite socket) — that found the `$1::jsonb` double-encoding, now fixed and covered in CI by running every job
with `--fixtures` against the local Supabase stack. Real data checked: the whoisds file (70,000 names) and the
Majestic top 100,000 (53,875 protected names; golden-set NDCG 0.981 → 0.983 with them loaded).
Also fixed: a search-replay unit test that failed once the committed price snapshot became older than 30 hours
(the likely cause of the failing Dependabot pull request on 2026-10-10).

## Decisions for this milestone (2026-10-10)
1. **Jobs get their own GitHub environment `jobs`.** Daily jobs cannot wait for a manual approval every day, so they
   use a new environment `jobs` (no reviewer, only the `main` branch may use it) that holds `SUPABASE_DB_URL` and,
   optionally, `RESEND_API_KEY` + `OWNER_ALERT_EMAIL`. The `production` environment keeps its reviewer for
   migrations, Jev and Porkbun keys. Fork pull requests never see either environment.
2. **The site reads the daily price list from the database.** The price job runs on GitHub (where Porkbun answers)
   and writes `tld_prices` and `fx_rates`. These tables are public reference data (spec 012 §4), so the site reads
   them with the public key even in mock mode. Order: database list (if under 30 h old) → Porkbun directly →
   committed snapshot. This fixes the open issue "Porkbun prices not reachable from Vercel".
3. **R-07 (newly registered names): use the whoisds free daily file.** The page says the free files may be reused
   "including for commercial purposes, without a license"; its terms forbid redistribution, which we never do. One
   download per day (plus at most 3 missed days — the page keeps 4), processed in memory, only aggregate trends kept
   (FR-REF-005). The free file is a sample (≈ 70,000 names a day), so it catches part of the new registrations.
4. **R-12 (popular sites): Majestic Million instead of Tranco.** Tranco states no licence and mixes sources under
   CC BY-NC and CC BY-SA; the Majestic Million is CC BY 3.0 (credit on the Status page). Same use: top 100,000 sites →
   site names for the brand check.
5. **Owner alerts.** A failed scheduled job already makes GitHub e-mail the owner. When a job fails twice in a row
   and `RESEND_API_KEY` + `OWNER_ALERT_EMAIL` are set, the job also sends one e-mail (FR-REF-014). Without them it
   only logs that the alert was skipped.
6. **Status page works without secrets.** A database function `public_job_status()` returns only job names, last
   success times and failure counts, so the page can read it with the public key. Without a database it shows the
   ages the server knows (prices, FX, RDAP directory).
7. **Moved out of M5:** watchlist re-checks and alerts, the owner `/ops` pages and `/ops/saved` need sign-in → new
   milestone M5b (accounts). Sentry, UptimeRobot and Cloudflare Web Analytics need owner accounts → M6 launch.

## A. Research
| # | Task | Requirement | Status |
|---|---|---|---|
| A1 | R-07 whoisds: URL `…/newly-registered-domains/{base64("YYYY-MM-DD.zip")}/nrd`, zip with `domain-names.txt`, 70,000 names, 4 days listed, reuse allowed, no redistribution | FR-REF-003, 016 | ☑ |
| A2 | R-12 popular-site list: Tranco (no stated licence, CC BY-NC/BY-SA inputs) → Majestic Million (CC BY 3.0, ~80 MB CSV) | FR-REF-007, 016 | ☑ |

## B. Job framework — `jobs/` (spec 010 tech §1, §5.7, §8)
| # | Task | Requirement | Status |
|---|---|---|---|
| B1 | `Db` interface with a Postgres adapter (pooler URL) and an in-process adapter (PGlite + migrations) for tests and `--dry-run` | FR-REF-011 | ☑ |
| B2 | `runJob`: advisory lock (held → `skipped`), `job_runs` lifecycle with stats, `--force`, exit code | FR-REF-011, 012 | ☑ |
| B3 | Downloads with 3 attempts and back-off, size and time limits; fixtures for dry runs | spec 010 §8 | ☑ |
| B4 | Double-failure alert (Resend e-mail to the owner; skipped when not configured) and public-log hygiene (counts only) | FR-REF-014, spec 010 §9 | ☑ |

## C. Jobs
| # | Task | Requirement | Status |
|---|---|---|---|
| C1 | `tld-registry` (daily): IANA list + RDAP directory → `tlds`, retired extensions; Sundays: wildcard scan of priced extensions | FR-REF-001, 009 | ☑ |
| C2 | `refresh-prices` (daily): Porkbun + Frankfurter → `tld_prices`, `tld_price_history` (changes only), `fx_rates`, `tlds.priced`, `tld_policies` from the seed; failed sanity check keeps yesterday's data | FR-REF-002, FR-PRC-011 | ☑ |
| C3 | `nrd-ingest` (daily): mark cached "available" names as taken, flag watched names, store aggregate trends; back-fill missed days; nothing else kept | FR-REF-003, 004, 005 | ☑ |
| C4 | `refresh-free-providers` (daily): provider seed → `free_providers`, health checks, taken lists → `free_provider_taken` | FR-REF-006, FR-FREE-005 | ☑ |
| C5 | `brand-list` (weekly): Majestic Million top 100k → site names (≥ 4 letters, not common words) + curated seed → `brand_labels` in one transaction | FR-REF-007 | ☑ |
| C6 | `cleanup` (daily): retention SQL (spec 012 §5.2), feedback roll-up, daily search metrics, database size + auto-mitigation, meters and budget alerts, stale-data alert, keep-alive | FR-REF-010, FR-DATA-003, 009, FR-OBS-002, 003, 004, 007 | ☑ |
| C7 | `backup` (weekly): database dump → `age` encryption with the owner's public key → workflow artifact kept 28 days | FR-DATA-008 | ☑ |
| C8 | `usage-report` (monthly): meters, job success rates, product metrics, manual checklist → `quality_reports` (+ e-mail) | FR-OBS-008, 011 | ☑ |
| C9 | `tune-weights` (monthly): logistic regression on stored signals + feedback → proposed weights and AUC as a report (a person decides) | FR-RANK-013, FR-REF-017 | ☑ |

## D. Workflows
| # | Task | Requirement | Status |
|---|---|---|---|
| D1 | One workflow per job with the spec 010 §5.1 schedule, `workflow_dispatch` (+ `force`), `concurrency`, 45-minute timeout, read-only permissions, environment `jobs` | FR-REF-012, 013, 016 | ☑ |
| D2 | CI: `actionlint` on all workflows; every job's `--dry-run` against fixtures and an in-process database | spec 010 §11 | ☑ |

## E. Site
| # | Task | Requirement | Status |
|---|---|---|---|
| E1 | Price source reads `tld_prices` + `fx_rates` from the database (public key), then Porkbun, then the snapshot | FR-PRC-011, FR-REF-002 | ☑ |
| E2 | Brand check uses `brand_labels` from the database (server key, refreshed every 12 h) with a fast substring index | FR-ABU-007, FR-REF-007 | ☑ |
| E3 | `public_job_status()` (migration), `GET /api/status`, `/status` page (revalidated every 5 min, > 30 h highlighted, sources credited), footer "Domain data updated … ago" | FR-REF-015, FR-UX-011, FR-SYS-010 | ☑ |

## F. Docs
| # | Task | Requirement | Status |
|---|---|---|---|
| F1 | `docs/setup.md`: `jobs` environment, optional Resend alert, backup key pair, first manual runs | FR-INF-013 | ☑ |
| F2 | Runbooks: re-run a job, re-enable workflows, restore a backup, Supabase un-pause, budget exhausted | FR-INF-008 | ☑ |
| F3 | Spec 010/014 tech notes (Majestic, whoisds, `jobs` environment), research R-07/R-12, roadmap M5b | — | ☑ |

## G. Owner steps
| # | Task | Status |
|---|---|---|
| G1 | Run **Actions → migrate → Run workflow** and approve it (the only migrate run so far failed on 2026-10-03, before the database existed) | ☐ |
| G2 | Create the GitHub environment `jobs` (Settings → Environments → New): deployment branches = `main` only, no reviewer; secret `SUPABASE_DB_URL` (same value as in `production`) | ☐ |
| G3 | Optional: Resend account (free) → `RESEND_API_KEY` + `OWNER_ALERT_EMAIL` in the `jobs` environment | ☐ |
| G4 | Backups: create an `age` key pair on your PC, keep the private key offline, save the public key as the repository **variable** `BACKUP_AGE_PUBLIC_KEY` | ☐ |
| G5 | Run each job once by hand (Actions → job → Run workflow), then check `/status` | ☐ |
| G6 | Exit: 7 days of green scheduled runs | ☐ |

## Not in M5
Watchlist re-checks, alerts, sign-in, saving, `/ops` (M5b); Sentry, UptimeRobot, Cloudflare Web Analytics, launch
checklist (M6); ICANN zone files (phase 3).
