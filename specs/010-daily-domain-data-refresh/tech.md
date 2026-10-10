# Tech 010 — Daily Domain Data Refresh

| Field | Value |
|---|---|
| Implements | [spec.md](./spec.md) |
| Status | Approved (2026-10-03) |
| Owning packages | `jobs/*`, `.github/workflows/*` |
| Last updated | 2026-10-03 |

## 1. Components and diagram

```
.github/workflows/<job>.yml  (schedule + workflow_dispatch)
   └─ pnpm tsx jobs/<job>/index.ts
        └─ runJob(name, fn)           jobs/_lib/run.ts
              ├─ lock (pg_try_advisory_lock(hash(name)))
              ├─ insert job_runs(status='running')
              ├─ fn(ctx) → stats
              ├─ update job_runs(status, finished_at, stats, error)
              └─ on failure: exit 1 (GitHub e-mails the owner) + if previous run also failed → Resend alert
```

## 2. Stack and libraries

| Concern | Choice | Notes |
|---|---|---|
| Scheduler | GitHub Actions `on.schedule` (cron, UTC) + `workflow_dispatch` | FR-REF-013 manual runs |
| Runtime | Node 22 + `tsx` | |
| DB access | `postgres` (porsager) over the Supabase pooler URL for bulk ops; `@supabase/supabase-js` where RLS-safe | |
| Zip | `yauzl` / `unzipper` streaming | |
| CSV | `csv-parse` streaming | |
| Registrable-domain parsing | `tldts` (Public Suffix List) | brand list only |
| Word segmentation | `packages/core/words/segment.ts` (Viterbi over word-frequency list) | trends |

## 3. Data model
Tables written (DDL in spec 012): `tlds`, `tld_prices`, `tld_price_history`, `fx_rates`, `domain_checks`,
`keyword_trends`, `free_providers`, `free_provider_taken`, `brand_labels`, `watchlist`, `saved_searches`,
`notifications`, `job_runs`, `quality_reports`.

```sql
create table job_runs (
  id bigint generated always as identity primary key,
  job text not null, run_date date not null,
  status text not null check (status in ('running','success','failed','skipped')),
  started_at timestamptz not null default now(), finished_at timestamptz,
  stats jsonb, error text
);
create index on job_runs (job, started_at desc);
```

## 4. Interfaces

```ts
export interface JobContext { db: Sql; log: Logger; now: Date; runDate: string; force: boolean; env: JobEnv }
export function runJob(name: JobName, fn: (ctx: JobContext) => Promise<Record<string, number|string>>): Promise<void>;
```
`GET /api/status` reads the latest successful `job_runs` per job to compute dataset ages.

## 5. Algorithms and logic

### 5.1 Schedule (UTC)

| Workflow | Cron | Job | Est. minutes |
|---|---|---|---|
| `daily-tld-registry.yml` | `30 0 * * *` | TLD list + RDAP bootstrap (+ wildcard scan on Sundays) | 2 (Sun 8) |
| `daily-prices.yml` | `0 1 * * *` | prices + FX | 1 |
| `daily-nrd.yml` | `0 2 * * *` | NRD ingest, invalidation, trends | 5 |
| `daily-free-providers.yml` | `30 2 * * *` | health + taken lists | 2 |
| `weekly-brand-list.yml` | `0 3 * * 0` | Tranco → brand_labels | 4 |
| `daily-watchlist.yml` | `0 4 * * *` | re-checks + notifications + digests | 5–10 |
| `daily-cleanup.yml` | `0 5 * * *` | retention, rollups, keep-alive | 1 |
| `weekly-backup.yml` | `30 5 * * 0` | pg_dump artifact (spec 017) | 3 |
| `weekly-jev-eval.yml` | `0 6 * * 1` | golden-set eval (spec 002) | 5 |
| `monthly-availability-accuracy.yml` | `0 6 1 * *` | accuracy sample (spec 005) | 40 |
| `monthly-tune-weights.yml` | `0 6 2 * *` | weight proposal (spec 008) | 2 |

Monthly minutes ≈ 30 × 17 + 4 × 20 + 42 ≈ **630 min** (+ CI ~500). The repository is public (owner decision
2026-10-03), so standard runners are free and unmetered; the estimate stays as a sanity check (NFR-REF-004).
Every workflow: `concurrency: { group: <job>, cancel-in-progress: false }` (FR-REF-012), `timeout-minutes: 45`.

### 5.2 TLD registry (FR-REF-001, FR-REF-009)
```
tlds_txt = GET https://data.iana.org/TLD/tlds-alpha-by-domain.txt       # validate: ≥ 1,000 lines, header comment
boot     = GET https://data.iana.org/rdap/dns.json                     # validate: services[] non-empty
upsert tlds(tld, type, rdap_base_url, has_rdap, updated_at)
  type: ccTLD if 2 letters; 'brand' if in seed list of closed brand TLDs; else gTLD
  also upsert second-level public suffixes we sell (co.in, co.uk, com.au …) from seed geo_tlds.json
mark tlds missing from IANA as retired (not deleted)
Sundays: for tlds with priced=true: DoH A query '{random20}.{tld}' → dns_wildcard
```

### 5.3 NRD ingest (FR-REF-003, 004, 005)
```
for day in [yesterday … up to 7 days back where no success run exists]:
  url  = NRD_URL_TEMPLATE with base64("{day}.zip")      # whoisds free list; R-07 confirms URL + terms
  file = stream download → unzip → lines (domain names, ~70k–200k)
  names = Set(lines.map(lowercase))
  -- invalidation --
  cached = SELECT fqdn FROM domain_checks WHERE status IN ('available','likely_available','available_premium')
           (paged, ~≤ 200k rows)
  hit = cached ∩ names → UPDATE domain_checks SET status='taken', method='nrd', checked_at=now(), expires_at=now()+'7 days'
  -- watchers --
  w = SELECT fqdn FROM watchlist WHERE last_status <> 'taken'; hitW = w ∩ names → notifications(kind='registered')
  -- trends --
  for n in names: label = n.split('.')[0]; tld = rest
     segs = segment(label) ; count tokens (len ≥ 3), first seg as prefix, last seg as suffix, tld
  insert keyword_trends(day, token, kind in ('token','prefix','suffix','tld'), count) — top 2,000 tokens, top 200 prefixes/suffixes, all tlds
  delete temp files (nothing else persisted)                               # FR-REF-005
stats: {day, names, invalidated, watchers, tokens}
```

### 5.4 Brand list (FR-REF-007)
```
zip = GET https://tranco-list.eu/top-1m.csv.zip (latest daily list)  # R-12 license/terms
top 100k rows → registrable domain via tldts → label (e.g. 'paypal')
keep labels length ≥ 4, not dictionary-common words (ENABLE top 20k), dedupe → brand_labels(label, best_rank)
plus curated seed brands (supabase/seed/brands_extra.json)
replace table atomically (insert into brand_labels_new; swap in a transaction)
```

### 5.5 Watchlist & saved searches (FR-REF-008) — details in spec 011
```
targets = distinct fqdns from watchlist ∪ top 10 results of saved searches with alerts on
recheck via packages/availability (force) with job-level caps (≤ 5,000 RDAP/day for this job)
compare with last_status / last_upfront → notifications rows
send digests (spec 011 §5.3) → Resend — skipped while EMAIL_MODE=off (phase 1); notifications stay in-app
```

### 5.6 Clean-up (FR-REF-010)
Runs the retention SQL from spec 012 §5.2, rolls up `jev_usage` and `search_metrics_daily`, and performs a trivial
`select 1` write-free query set (keeps the free Supabase project active — free projects pause after 7 days without activity).

### 5.7 Failure alerts (FR-REF-014)
- GitHub sends failure e-mails for failed scheduled workflows to the repository owner by default.
- Additionally `runJob` checks the previous run: if it also failed → send an owner alert via Resend
  (`OWNER_ALERT_EMAIL`), subject `[domains-all] <job> failed twice`.

## 6. External services and free-tier limits

| Source | Used for | Limit / terms | Source URL | Verified |
|---|---|---|---|---|
| IANA TLD list | extension list | public file | data.iana.org/TLD/tlds-alpha-by-domain.txt | 2026-09-29 |
| IANA RDAP bootstrap | registry directory | public file | data.iana.org/rdap/dns.json | 2026-09-29 |
| Porkbun pricing | prices | no auth, daily use | porkbun.com/api/json/v3/documentation | R-04 |
| Frankfurter | FX | free | frankfurter.app | R-09 |
| whoisds free NRD list | newly registered | free daily list (domain names only) | whoisds.com/newly-registered-domains | R-07 |
| Tranco | popular sites | free list; research-oriented terms | tranco-list.eu | R-12 |
| GitHub Actions | scheduler | unlimited on public repositories (ours); 2,000 min/month private | docs.github.com/billing | R-09 |

## 7. Configuration and secrets (GitHub Actions secrets)
`SUPABASE_DB_URL` (pooler, service role), `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY`,
`OWNER_ALERT_EMAIL`, `PORKBUN_API_KEY`, `PORKBUN_SECRET_KEY` (accuracy/premium jobs), `AI_GATEWAY_API_KEY` (eval),
`NRD_URL_TEMPLATE` (config variable).

## 8. Errors, retries and fallbacks

| Failure | Response |
|---|---|
| Download error | 3 attempts with 30 s backoff inside the job |
| Validation fails | abort without writes; status failed |
| DB connection drops | transaction per batch; job resumable (idempotent upserts) |
| Advisory lock held | status `skipped` |

## 9. Security and privacy controls
- Secrets only in GitHub Actions secrets; workflows use `permissions: contents: read` (least privilege).
- Pinned action versions by commit SHA.
- NRD data is public domain names; not stored beyond aggregates.
- Job logs never print secrets or user e-mails (masked). The repository is public, so **workflow logs are public**:
  jobs print only counts and durations — never row contents, e-mails, fqdn lists tied to users, or descriptions.

## 10. Performance and cost budgets
NRD intersection in memory: 200k names Set ≈ 20 MB — fine on the 7 GB runner. Batch updates of ≤ 1,000 rows per statement.

## 11. Test plan

| Test | Type | What it proves |
|---|---|---|
| `run-job.test.ts` | unit | lock, job_runs lifecycle, double-failure alert |
| `tld-registry.test.ts` | unit + fixtures | parsing IANA files, validation, retired TLDs |
| `nrd-ingest.int.test.ts` | integration (local Supabase) | invalidation, watcher flags, trends, idempotent re-run, backfill of missed days |
| `brand-list.test.ts` | unit | label extraction, filters, atomic swap |
| `cleanup.int.test.ts` | integration | retention SQL deletes only expired rows |
| workflow lint | CI | `actionlint` on all workflow files |
| dry-run mode | CI | each job with `--dry-run` against fixtures on PRs touching `jobs/` |

## 12. Observability
`job_runs` dashboard (Status page internal section), dataset ages via `/api/status`, alert e-mails.

## 13. Traceability matrix

| Requirement | Component(s) | Test(s) |
|---|---|---|
| FR-REF-001 | `jobs/tld-registry` | `tld-registry.test.ts` |
| FR-REF-002 | `jobs/refresh-prices` (spec 006) | `refresh-prices.int.test.ts` |
| FR-REF-003 | `jobs/nrd-ingest` | `nrd-ingest.int.test.ts` |
| FR-REF-004 | trends in `nrd-ingest` | `nrd-ingest.int.test.ts` |
| FR-REF-005 | no persistence of raw list | `nrd-ingest.int.test.ts` (asserts no table growth beyond aggregates) |
| FR-REF-006 | `jobs/refresh-free-providers` (spec 007) | `free-health.int.test.ts` |
| FR-REF-007 | `jobs/brand-list` | `brand-list.test.ts` |
| FR-REF-008 | `jobs/watchlist` (spec 011) | `watchlist-job.int.test.ts` |
| FR-REF-009 | wildcard scan | `tld-registry.test.ts` |
| FR-REF-010 | `jobs/cleanup` | `cleanup.int.test.ts` |
| FR-REF-011 | `runJob`, upserts | `run-job.test.ts`, idempotency tests |
| FR-REF-012 | workflow `concurrency` + advisory lock | `run-job.test.ts`, actionlint |
| FR-REF-013 | `workflow_dispatch` | actionlint config check |
| FR-REF-014 | double-failure alert | `run-job.test.ts` |
| FR-REF-015 | `/api/status`, Status page | `status.spec.ts` |
| FR-REF-016 | schedules, caps §5.1 | minutes report (spec 015) |
| FR-REF-017 | eval/accuracy/tune workflows | workflow artifacts |
| NFR-REF-001 | `timeout-minutes`, stats | job_runs durations |
| NFR-REF-002 | job_runs | monthly report |
| NFR-REF-003 | schedule | `/api/status` |
| NFR-REF-004 | minutes budget | GitHub billing page (monthly check) |

## 14. Risks and research links
- R-07 whoisds automation terms/URL format (fallback: skip NRD invalidation; rely on TTLs and live re-checks; or ICANN CZDS zone diffs in phase 3).
- R-12 Tranco terms. R-09 GitHub Actions minutes.
- Risk: GitHub may delay scheduled workflows at busy times (minutes-level) — acceptable; status page shows true ages.
- Risk: GitHub disables scheduled workflows in public repositories after 60 days without repository activity.
  Mitigation: the weekly eval job commits nothing, so the owner gets GitHub's warning e-mail; the Status page
  also shows data ages; re-enable with one click (documented in spec 017 runbook).

## 15. Implementation notes (M5, 2026-10-10)
- **Lock.** `runJob` takes a lease row in `job_runs` under `pg_advisory_xact_lock` instead of a session
  `pg_try_advisory_lock`: Supabase's transaction pooler may run each statement on a different server connection, so
  session locks are unreliable there. A `running` row older than 50 minutes counts as abandoned. Workflows also use
  `concurrency` groups.
- **Secrets.** Jobs run in a GitHub environment `jobs` (main branch only, no reviewer) holding `SUPABASE_DB_URL` and
  the optional `RESEND_API_KEY` / `OWNER_ALERT_EMAIL`; `production` keeps its reviewer. Without the secret a job
  ends with a "not configured" warning instead of failing daily.
- **Popular sites (§5.4):** the Majestic Million (CC BY 3.0) replaces Tranco (research R-12): Tranco states no
  licence and mixes CC BY-NC / CC BY-SA inputs. Ordinary words, plurals and runs of dictionary words are left out
  (`bookstore`, `petsupplies`), leaving about 54,000 names from the top 100,000 sites (measured 2026-10-10). The
  server loads them with the service-role function `brand_label_list()`; golden-set NDCG stayed 0.98 with them.
- **Newly registered names (§5.3):** whoisds free file (research R-07), `.../newly-registered-domains/
  {base64("YYYY-MM-DD.zip")}/nrd`, about 70,000 names a day (a sample), 4 days listed. A day counts as done once
  `keyword_trends` has its `tld` rows; missing days are retried while the page still lists them. The job fails only
  when the latest processed day is older than the day before yesterday.
- **Bulk writes** pass one JSON text parameter (`jsonb_to_recordset($1::text::jsonb)`). Typed `$1::jsonb`, the
  production driver JSON-encodes the string a second time (found with a real wire-protocol test before release).
- **Tests and dry runs.** `pnpm job <name> --dry-run` uses recorded sources and an in-process Postgres (PGlite) with
  all migrations; `--fixtures` uses recorded sources with a real database. CI runs every job that way against its
  local Supabase stack (`db` job), so the production driver is exercised without going online.
- **Status page** reads `public_job_status()` (job names, run times, failures in a row; no statistics or error
  text) with the public key, so it also works while the site runs in mock mode.
- **Watchlist job (§5.5)** moves to milestone M5b with sign-in; `nrd-ingest` already flags watched names.
- **Backups** use `supabase db dump` (schema, then data; matching `pg_dump` in Docker) plus `auth.users`
  (id, e-mail, anonymous flag, created) as CSV, packed and encrypted with `age`; the workflow uploads only the
  encrypted file.
