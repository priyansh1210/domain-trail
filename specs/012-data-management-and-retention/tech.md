# Tech 012 — Data Management and Retention

| Field | Value |
|---|---|
| Implements | [spec.md](./spec.md) |
| Status | Approved (2026-10-03) |
| Owning packages | `supabase/migrations`, `supabase/seed`, `packages/db`, `jobs/cleanup`, `jobs/backup` |
| Last updated | 2026-10-03 |

## 1. Components and diagram

```
supabase/migrations/NNNN_*.sql  ──(supabase db push / CI)──▶ Supabase Postgres (free plan, 500 MB)
supabase/seed/*.json            ──(jobs/seed)──────────────▶ reference tables
packages/db                     generated types (supabase gen types typescript) + typed query helpers
jobs/cleanup (daily)            retention SQL §5.2
jobs/backup (weekly)            pg_dump → encrypted artifact (spec 017)
```

## 2. Stack and libraries
Supabase Postgres 15+, Supabase CLI (migrations, local Docker stack, type generation), `postgres` driver for jobs,
`@supabase/supabase-js` for app queries under RLS.

## 3. Data model — full schema (v1)

```sql
-- ===== enums =====
create type check_status as enum ('available','likely_available','available_premium','taken','dropping_soon','unknown');
create type tier as enum ('free','budget','mid','premium');   -- internal codes; UI shows price ranges only

-- ===== reference data (public read) =====
create table tlds (
  tld text primary key,                        -- 'com', 'co.in'
  type text not null,                          -- 'gTLD' | 'ccTLD' | 'brand' | 'sld'
  rdap_base_url text, has_rdap boolean not null default false,
  dns_wildcard boolean not null default false,
  priced boolean not null default false,
  retired boolean not null default false,
  rdap_rps smallint,                           -- per-registry politeness override
  availability_notes text,
  updated_at timestamptz not null default now()
);
create table tld_policies (
  tld text primary key references tlds(tld),
  restriction text not null default 'none', restriction_note text,
  min_years smallint not null default 1, requires_https boolean not null default false,
  has_premium_names boolean not null default false, description text, reviewed_at date
);
create table tld_prices (
  tld text references tlds(tld), provider text, currency char(3) not null default 'USD',
  register_cents int, renew_cents int, transfer_cents int, is_promo boolean not null default false,
  fetched_at timestamptz not null, primary key (tld, provider)
);
create table tld_price_history (
  tld text, provider text, register_cents int, renew_cents int, changed_at timestamptz not null,
  primary key (tld, provider, changed_at)
);
create table fx_rates (base char(3), quote char(3), rate numeric(18,8) not null, as_of date not null,
  primary key (base, quote, as_of));
create table free_providers ( /* spec 007 tech §3 */ id text primary key, name text not null, suffix text not null,
  kind text not null, eligibility jsonb not null, steps text[] not null, wait_time text, official_url text not null,
  check_method text not null, check_config jsonb, healthy boolean not null default true, health_note text,
  last_health_at timestamptz, reviewed_at date not null);

-- ===== server-only reference / caches =====
create table domain_checks ( /* spec 005 tech §3 */
  fqdn text primary key, tld text not null references tlds(tld), status check_status not null,
  method text not null, premium_price_cents int, premium_currency char(3), premium_source text,
  drop_window_start date, drop_window_end date,
  checked_at timestamptz not null, expires_at timestamptz not null);
create index domain_checks_expires on domain_checks (expires_at);
create index domain_checks_tld_status on domain_checks (tld, status);
create table free_provider_taken (provider_id text references free_providers(id) on delete cascade,
  label text, synced_at timestamptz not null, primary key (provider_id, label));
create table brand_labels (label text primary key, best_rank int not null, source text not null);
create table keyword_trends (day date, token text, kind text, count int not null, primary key (day, kind, token));
create table word_cache (term text, relation text, words jsonb not null, fetched_at timestamptz not null,
  primary key (term, relation));

-- ===== searches (no description column by design) =====
create table searches (
  id uuid primary key,                          -- uuidv7
  user_id uuid references auth.users(id) on delete set null,
  cache_key text not null,
  status text not null check (status in ('running','done','refused','needs_detail','error')),
  prefs jsonb not null, features jsonb, degraded boolean not null default false,
  jev_tokens int not null default 0, duration_ms int, stage_ms jsonb, pipeline_version text not null,
  created_at timestamptz not null default now(), expires_at timestamptz not null
);
create index searches_expires on searches (expires_at);
create table search_results (
  search_id uuid references searches(id) on delete cascade, fqdn text,
  section text not null, rank int not null, score real not null,
  status text not null, upfront_cents int, renew_cents int, price_source text,
  signals jsonb not null, reasons jsonb not null, strategy text not null,
  primary key (search_id, fqdn)
);
create table result_cache (cache_key text primary key, search_id uuid references searches(id) on delete cascade,
  created_at timestamptz not null default now(), expires_at timestamptz not null);

-- ===== feedback (pseudonymous) =====
create table feedback (search_id uuid, fqdn text, visitor_hash text, vote smallint not null check (vote in (-1,1)),
  reason text check (reason in ('offensive','brand','other')),          -- set for "Report" (spec 014)
  created_at timestamptz not null default now(), primary key (search_id, fqdn, visitor_hash));
create table result_events (id bigint generated always as identity primary key, search_id uuid, fqdn text,
  action text not null, created_at timestamptz not null default now());
create table feedback_monthly (month date, section text, strategy text, votes_up int, votes_down int,
  buy_clicks int, copies int, primary key (month, section, strategy));   -- aggregates kept after 13 months

-- ===== user data (RLS: owner only) — spec 011 tech §3 =====
-- profiles, saved_searches, watchlist, notifications, anon_visitors (DDL in spec 011)
-- signed-out savers are Supabase anonymous users (auth.users.is_anonymous = true); their saved_searches have no description

-- ===== contact / grievance (spec 013) =====
create table contact_messages (id bigint generated always as identity primary key, email text not null,
  message text not null check (char_length(message) <= 4000), created_at timestamptz not null default now(),
  handled_at timestamptz);                        -- retention 1 year

-- ===== operations =====
create table jev_usage (day date primary key, input_tokens bigint not null default 0, requests int not null default 0,
  searches int not null default 0, degraded_searches int not null default 0, eval_tokens bigint not null default 0);
create table email_log (day date, provider text, sent int not null default 0, primary key (day, provider));
create table job_runs ( /* spec 010 tech §3 */ id bigint generated always as identity primary key, job text not null,
  run_date date not null, status text not null, started_at timestamptz not null default now(),
  finished_at timestamptz, stats jsonb, error text);
create table quality_reports (id bigint generated always as identity primary key, kind text not null,
  period text not null, metrics jsonb not null, created_at timestamptz not null default now());
create table search_metrics_daily (day date primary key, searches int, cache_hits int, p50_ms int, p95_ms int,
  p50_stage_ms jsonb, p95_stage_ms jsonb, avg_tokens int, degraded int, refused int, needs_detail int,
  actions int, thumbs_up int, thumbs_down int);
```

RPCs (security definer, callable only by service role):
- `jev_usage_add(p_day date, p_tokens bigint, p_requests int, p_degraded boolean)` — atomic upsert.
- `month_jev_tokens(p_month date) returns bigint`.

## 4. Interfaces — access matrix (RLS)

| Table group | anon (browser) | authenticated user | service role (server/jobs) |
|---|---|---|---|
| tlds, tld_policies, tld_prices, tld_price_history, fx_rates, free_providers | select | select | all |
| domain_checks, free_provider_taken, brand_labels, keyword_trends, word_cache | — | — | all |
| searches, search_results, result_cache | — (served via API) | — | all |
| feedback, result_events, feedback_monthly | — | — | all |
| profiles, saved_searches, watchlist, notifications, anon_visitors | — | own rows only (anonymous sessions: saved_searches without description, watchlist) | all (jobs, and `/ops/saved` admin view after `ADMIN_USER_IDS` check) |
| jev_usage, email_log, job_runs, quality_reports, search_metrics_daily, contact_messages | — | — | all |

RLS is **enabled on every table**; tables without a policy deny by default. The browser only talks to our API routes
(except Supabase Auth and the four owner-only tables through the SSR client).

## 5. Algorithms and logic

### 5.1 Migrations (FR-DATA-007)
- One SQL file per change `supabase/migrations/YYYYMMDDHHMM_<name>.sql`; never edited after merge.
- CI: `supabase start` → apply all migrations → run integration tests → `supabase db diff` must be empty.
- Deploy: GitHub Action on `main` runs `supabase db push` with the production DB URL (requires manual approval via a
  protected GitHub environment).

### 5.2 Retention SQL (daily, FR-DATA-003)
```sql
delete from searches where expires_at < now()
  and id not in (select search_id from saved_searches where search_id is not null);   -- cascades to results/cache
delete from result_cache where expires_at < now();
delete from domain_checks where expires_at < now() - interval '30 days';
delete from word_cache where fetched_at < now() - interval '30 days';
delete from keyword_trends where day < current_date - 180;
delete from fx_rates where as_of < current_date - 90;
delete from notifications where created_at < now() - interval '90 days';
delete from auth.users where id in (select user_id from anon_visitors
  where last_seen_at < now() - interval '90 days');                                 -- signed-out saved items (cascades)
delete from contact_messages where created_at < now() - interval '1 year';
delete from email_log where day < current_date - 90;
delete from job_runs where started_at < now() - interval '90 days';
-- feedback: aggregate then delete
insert into feedback_monthly (...) select ... from feedback/result_events where created_at < date_trunc('month', now()) - interval '13 months' group by ...
  on conflict do update ...;
delete from feedback where created_at < date_trunc('month', now()) - interval '13 months';
delete from result_events where created_at < date_trunc('month', now()) - interval '13 months';
```
`searches.expires_at = created_at + 7 days` (anonymous); saved searches keep their latest `search_id` alive.

### 5.3 Storage budget (FR-DATA-009, NFR-DATA-001)

| Table | Rows (steady state) | Avg row + index | Size |
|---|---|---|---|
| domain_checks | ~400k (30-day window) | ~180 B | ~72 MB |
| searches | ~7 days × 300/day = 2.1k | ~2 KB (features jsonb) | ~5 MB |
| search_results | 2.1k × 200 | ~400 B | ~170 MB ⚠ |
| keyword_trends | 180 × 2.5k | ~60 B | ~27 MB |
| word_cache | ~20k | ~1 KB | ~20 MB |
| brand_labels | 20k | ~50 B | ~1 MB |
| tld_* + fx | ~5k | small | ~2 MB |
| feedback/events (13 mo) | ~500k | ~80 B | ~40 MB |
| user tables | ~10k users | small | ~10 MB |
| **Total** | | | **~350 MB** at 300 searches/day |

⚠ `search_results` dominates → store at most **40 results per section** (the first two "Show more" pages) plus
dropping/unpriced lists (≈ 150 rows, not 200+) and compact `signals` (short keys, 2-decimal numbers, ~250 B/row)
→ ~80 MB, total ≈ **260 MB**. Beyond 40 per section, users use "Find more". Auto-mitigation when size > 60%
(300 MB): cleanup shortens `domain_checks` grace to 14 days and anonymous search retention to 3 days, and alerts.
Size check: `select pg_database_size(current_database())` in the cleanup job → `job_runs.stats`.

### 5.4 Backups (FR-DATA-008)
Supabase free plan has no downloadable backups (R-09) → weekly GitHub Action:
`pg_dump --format=custom --no-owner` of the public schema + `auth.users` minimal columns → encrypt with `age`
(public key in repo, private key held by owner offline) → upload as workflow artifact with `retention-days: 28`.
Quarterly restore drill into the local Supabase stack (runbook in spec 017).

### 5.5 Reference data validation (FR-DATA-010)
Loads write to `*_staging` tables, validate (row counts, value ranges, required keys), then swap/merge in one transaction.

### 5.6 Visitor hash (FR-DATA-011)
`visitor_hash = HMAC_SHA256(DAILY_SALT, ip + '|' + userAgent)`; `DAILY_SALT` derived as HMAC(`VISITOR_SALT_SECRET`, UTC date)
— never stored; yesterday's hashes cannot be linked to today's or reversed without the secret + IP.

## 6. External services and free-tier limits

| Service | Limit | Source | Verified |
|---|---|---|---|
| Supabase free | 500 MB database, 5 GB egress, 50k MAU, pauses after 7 days inactivity, no downloadable backups, 2 free projects | supabase.com/pricing | R-09 |

## 7. Configuration and secrets
`SUPABASE_DB_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `VISITOR_SALT_SECRET`, `BACKUP_AGE_PUBLIC_KEY` (repo), retention values in `packages/config`.

## 8. Errors, retries and fallbacks

| Failure | Response |
|---|---|
| Migration fails in CI | PR blocked |
| Migration fails in prod | transaction rollback; deploy job fails; app unaffected (migrations are backward compatible: expand → migrate → contract) |
| Size > 60% | auto-mitigation §5.3 + alert |
| Backup job fails | alert; next week retries; owner can trigger manually |

## 9. Security and privacy controls
- RLS everywhere; service role only on server and in Actions.
- No description column in `searches` (FR-DATA-002) — enforced by a CI test that inspects the schema.
- `search_results` contains only domain/ranking data (FR-DATA-012).
- Backups encrypted. The repository is public, so workflow artifacts can be downloaded by any signed-in GitHub
  user — `age` encryption is therefore mandatory, and the private key never touches the repository or Actions.

## 10. Performance and cost budgets
Primary-key lookups for cache (`fqdn = any($1)`, ≤ 300 keys) < 20 ms; snapshot read (1 search + ≤ 100 results) < 30 ms.

## 11. Test plan

| Test | Type | What it proves |
|---|---|---|
| `schema-guard.test.ts` | integration | no description-like columns in anonymous tables; RLS enabled on all tables |
| `rls-matrix.int.test.ts` | integration | §4 matrix for anon/authenticated/service |
| `retention.int.test.ts` | integration | §5.2 deletes exactly expired rows; saved-search-linked searches survive; idle anonymous savers removed |
| `staging-swap.int.test.ts` | integration | invalid loads don't replace data |
| `money-time.test.ts` | unit | cents/currency helpers; UTC only |
| migration CI | CI | apply from scratch + empty diff |
| restore drill | manual quarterly | NFR-DATA-002 |

## 12. Observability
DB size trend, row counts per table (weekly), retention deletions per run, backup success.

## 13. Traceability matrix

| Requirement | Component(s) | Test(s) |
|---|---|---|
| FR-DATA-001 | spec inventory §3 + PR checklist | review checklist |
| FR-DATA-002 | schema (no description in `searches`) | `schema-guard.test.ts` |
| FR-DATA-003 | `jobs/cleanup` §5.2 | `retention.int.test.ts` |
| FR-DATA-004 | RLS policies; admin view via service role (spec 011 §5.8) | `rls-matrix.int.test.ts`, `admin-view.spec.ts` |
| FR-DATA-005 | public select policies | `rls-matrix.int.test.ts` |
| FR-DATA-006 | `*_cents` columns, `timestamptz` | `money-time.test.ts`, `schema-guard.test.ts` |
| FR-DATA-007 | migrations workflow | migration CI |
| FR-DATA-008 | `weekly-backup.yml` | backup job + restore drill |
| FR-DATA-009 | size check + auto-mitigation | `cleanup.int.test.ts` |
| FR-DATA-010 | staging swap | `staging-swap.int.test.ts` |
| FR-DATA-011 | visitor hash §5.6 | `visitor-hash.test.ts` |
| FR-DATA-012 | result schema | `schema-guard.test.ts` |
| NFR-DATA-001 | §5.3 budget | weekly size metric |
| NFR-DATA-002 | restore runbook | quarterly drill |
| NFR-DATA-003 | weekly backups | backup job history |
| NFR-DATA-004 | indexes | `db.perf.test.ts` |

## 14. Risks and research links
- R-09: Supabase free limits (size, pause, backups).
- Risk: traffic growth beyond ~300 searches/day stresses the 500 MB limit → retention auto-tuning; next step would be a paid plan (owner decision).
