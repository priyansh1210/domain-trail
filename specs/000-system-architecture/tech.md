# Tech 000 — System Architecture

| Field | Value |
|---|---|
| Implements | [spec.md](./spec.md) |
| Status | Approved (2026-10-03) |
| Owning packages | whole repository |
| Last updated | 2026-10-03 |

## 1. Components and diagram

```
                       ┌────────────────────────────── Vercel (Hobby, free) ─────────────────────────────┐
 Browser               │  apps/web (Next.js App Router)                                                   │
 ┌──────────────┐ HTTPS │  ┌───────────────┐   ┌──────────────────────────────────────────────────────┐   │
 │ React UI     │──────▶│  │ Pages / RSC   │   │ Route handlers (/api/*)                              │   │
 │ (results,    │◀──SSE─│  └───────────────┘   │  search orchestrator = packages/core pipeline S0–S9  │   │
 │  slider…)    │       │                      └──────┬───────────┬───────────┬──────────┬────────────┘   │
 └──────────────┘       └─────────────────────────────┼───────────┼───────────┼──────────┼────────────────┘
                                                      │           │           │          │
                   ┌──────────────────────────────────┘           │           │          │
                   ▼                                              ▼           ▼          ▼
     Vercel AI Gateway → TypeSafe Jev            DoH resolvers   RDAP servers   Datamuse API
     (features, ranking, TLD fit, safety)        (Cloudflare,    (per TLD, via  (related words)
                                                  Google)         IANA bootstrap)
                   │
                   ▼
     Supabase (free): Postgres + Auth + RLS  ◀──────────────┐        Upstash Redis (free): rate limits
                                                            │
 GitHub Actions (cron, free) ── jobs/* ─────────────────────┘
   IANA TLD list + RDAP bootstrap · Porkbun pricing · FX rates · whoisds NRD · Tranco list ·
   free-provider sync · watchlist re-checks → Resend e-mail · cleanup · golden eval
```

| Component | Responsibility | Spec |
|---|---|---|
| `apps/web` | UI, route handlers, SSE streaming, auth callbacks | 001, 009, 011 |
| `packages/core` | Pipeline orchestration, normalization, generation, scoring, tiering | 001, 004, 006, 008 |
| `packages/jev` | Typed Jev client, question catalog, response schemas, fixtures, budget guard | 002, 003 |
| `packages/availability` | DoH client, RDAP bootstrap + client, rate limiting per server, check cache | 005 |
| `packages/pricing` | Price provider adapters, FX, tier function, TLD policies | 006 |
| `packages/free-domains` | Free provider registry and availability methods | 007 |
| `packages/db` | Generated Supabase types, typed queries, migrations helpers | 012 |
| `packages/config` | Shared config: weights, caps, TTLs, feature flags (zod-validated) | all |
| `jobs/` | Daily/weekly scripts run by GitHub Actions | 010 |
| `supabase/` | SQL migrations, seed data, RLS policies | 012 |

## 2. Stack and libraries

| Concern | Choice | Version / notes |
|---|---|---|
| Runtime | Node.js | 22 LTS |
| Language | TypeScript | 5.x, `strict: true` |
| Monorepo | pnpm workspaces + Turborepo | free, local + remote cache off |
| Web framework | Next.js (App Router, route handlers, RSC) | latest stable at implementation time |
| UI | Tailwind CSS + shadcn/ui (Radix primitives) | accessible components |
| Validation | zod | shared request/response schemas |
| Database + auth | Supabase (Postgres 15+, Auth, RLS) | free plan |
| DB client | `@supabase/supabase-js` + generated types (`supabase gen types`) | |
| Rate limiting | `@upstash/ratelimit` + `@upstash/redis` | free plan |
| Decision model | TypeSafe Jev via `@typesafe-ai/sdk` | base URL `https://ai-gateway.vercel.sh/typesafe` |
| NLP | `wink-nlp` + `wink-eng-lite-web-model` | keyword/noun-phrase extraction |
| E-mail | Resend (+ `react-email` templates) | free plan |
| Bot protection | Cloudflare Turnstile | free |
| Analytics | Cloudflare Web Analytics | free, cookieless |
| Errors | Sentry (`@sentry/nextjs`) | free developer plan |
| Tests | Vitest, MSW, Playwright | see spec 016 |
| Scheduling | GitHub Actions `schedule:` workflows | see spec 010 |

## 3. Repository layout (to be created during implementation)

```
domains-all/
  apps/web/                     Next.js app
    app/(marketing)/            home, how-it-works, privacy, terms, status
    app/s/[id]/                 results page
    app/account/                saved searches, watchlist, settings
    app/api/                    route handlers (see spec 009 OpenAPI)
  packages/core/                pipeline + domain logic
  packages/jev/                 Jev client + question catalog
  packages/availability/        DoH + RDAP
  packages/pricing/             price adapters, FX, tiers
  packages/free-domains/        free provider adapters
  packages/db/                  types + queries
  packages/config/              config schema + defaults
  jobs/                         daily job entry points (tsx)
  supabase/migrations/          SQL
  supabase/seed/                tld_policies.json, taxonomy, free providers
  .github/workflows/            ci.yml, daily-*.yml, weekly-*.yml
  docs/, specs/                 this documentation
```

## 4. Search pipeline (S0–S9) — sequence

```
Browser            /api/search            core pipeline                          external
  │ POST desc+prefs   │                        │                                     │
  │──────────────────▶│ S0 validate, Turnstile,│                                     │
  │                   │ rate limit, cache key  │                                     │
  │◀─ SSE: search_created {id} (the POST response itself streams; see spec 001 tech)│
  │                   │───────── run ─────────▶│ S1 features + safety ─────────────▶ Jev (2 req)
  │◀─ event:features ─│◀───────────────────────│                                     │
  │                   │                        │ S2 keywords (wink) + Jev weights ──▶ Jev, Datamuse
  │                   │                        │ S3 generate 500–2,000 labels        │
  │                   │                        │ S4 prefilter → ≤1,000               │
  │                   │                        │ S5 Jev round 1 (shards) ──────────▶ Jev (1–2 req)
  │                   │                        │ S6 Jev round 2 (score/noul/TLD) ──▶ Jev (2–4 req)
  │                   │                        │ S7 availability: cache→DoH→RDAP ──▶ DoH, RDAP
  │◀─ event:batch ────│◀── per confirmed batch─│ S8 price + tier                     │
  │◀─ event:update ───│                        │ S9 final score + reasons            │
  │◀─ event:done ─────│  persist results ─────▶ Supabase                             │
```

Stages S1 and S2 run in parallel where possible (S2's Datamuse calls do not depend on S1).
S7 starts as soon as S6 returns its first batch; results stream in batches of ~10.

## 5. Environments

| Environment | Web | Database | Jev model | Purpose |
|---|---|---|---|---|
| local | `pnpm dev` | Supabase local (Docker) | fixtures by default, live optional | development |
| preview | Vercel preview per PR | shared "staging" Supabase project (optional; free plan allows 2 projects) | `jev-1.13.0` | review |
| production | Vercel production (main branch) | production Supabase project | `jev-1.13.0` (pinned) | users |

## 6. Cross-cutting conventions
- **Config:** all tunables (weights, TTLs, caps, thresholds) in `packages/config/defaults.ts`, validated by zod,
  overridable by env vars. No magic numbers in feature code.
- **Errors:** typed `Result<T, E>` style for external calls; never throw across package boundaries for expected failures.
- **Time:** all timestamps UTC, stored as `timestamptz`.
- **Money:** stored as integer **cents** (`price_cents`) + ISO currency code; never floats.
- **IDs:** UUID v7 for rows created by the app (time-ordered), natural keys for reference data (`tld`, `fqdn`).
- **Logging:** structured JSON logs; never log raw descriptions, e-mails or IPs (spec 013).
- **Versioning:** `PIPELINE_VERSION` constant bumps whenever generation/ranking logic changes; it is part of the cache key.
- **Site identity (FR-SYS-011):** the product name and address live only in `NEXT_PUBLIC_SITE_NAME` and
  `NEXT_PUBLIC_SITE_URL` (read through `packages/config`). Metadata, links, CSP, the origin check and e-mail templates
  read them; no host name is hard-coded. Launch address: `<project>.vercel.app` (free, non-commercial Hobby plan);
  moving to an owned domain = add the domain in Vercel + change the two env vars + update Supabase Auth redirect URLs.

## 7. Architecture decision records (summaries)

| ADR | Decision | Reason | Alternatives rejected |
|---|---|---|---|
| ADR-001 | Next.js on Vercel Hobby | Simplest full-stack TS hosting, previews per PR, AI Gateway free credit on same account | Cloudflare all-in (10 ms CPU limit, DIY auth) |
| ADR-002 | Supabase for Postgres + Auth | SQL + RLS + auth in one free project | Neon + separate auth; Cloudflare D1 |
| ADR-003 | Jev as judge, deterministic generator | Jev does not generate text; typed probabilities are ideal for ranking | Using an LLM to generate names (extra cost, not requested) |
| ADR-004 | DoH prefilter + RDAP confirmation | Free, authoritative, low load on registries | Paid availability APIs; WHOIS scraping |
| ADR-005 | GitHub Actions for scheduled jobs | Free minutes, long runtimes, secrets, logs | Vercel cron (Hobby: once/day, short timeouts) |
| ADR-006 | Upstash only for rate limiting | Free 500k commands/month is enough for 2–3 commands per search | Storing rate-limit counters in Postgres |
| ADR-007 | Streaming results with SSE | Meets "first results < 5 s" | Polling; WebSockets (not needed) |

## 8. Errors, retries and fallbacks (system level)

| Failure | Response | Detailed in |
|---|---|---|
| Jev error / budget exhausted | Degraded mode (deterministic ranking) | 002, 015 |
| Datamuse down | Offline synonym list | 004 |
| DoH down | Skip to RDAP (Google DoH as second resolver first) | 005 |
| RDAP 429/timeouts | Backoff, mark `unknown`, show "verify at registrar" | 005 |
| Supabase down | Search still runs without cache/persistence; results not shareable; banner | 012, 015 |
| Upstash down | Fail open with a strict in-memory per-instance limit | 014 |

## 9. Security and privacy controls
Summarized here, specified in 013 and 014: Turnstile on search, rate limits, RLS on every user table,
service-role key only on the server and in GitHub Actions, CSP headers, no raw descriptions stored for anonymous users.

## 10. Performance and cost budgets

| Budget | Value |
|---|---|
| Jev tokens per uncached search | ≤ 25,000 (target 15,000) |
| Jev requests per search | ≤ 8 |
| DoH queries per search | ≤ 400 |
| RDAP queries per search | ≤ 120 (only NXDOMAIN / errors) |
| Datamuse calls per search | ≤ 15 |
| Supabase writes per search | ≤ 5 statements (batched upserts) |
| Serverless duration per search | ≤ 25 s wall time (streaming) |

## 11. Test plan
- End-to-end: Playwright journeys J-1…J-4 with Jev/DoH/RDAP mocked (MSW) plus one nightly live smoke test.
- Performance: a synthetic search benchmark in CI measuring time-to-first-batch against mocks (regression guard).

## 12. Observability
See spec 015: Sentry errors, `job_runs`, `jev_usage`, `/status` page, latency metrics per stage (S0–S9).

## 13. Traceability matrix

| Requirement | Component(s) | Test(s) |
|---|---|---|
| FR-SYS-001 | `apps/web/app/api/search`, no auth guard | e2e `anonymous-search.spec.ts` |
| FR-SYS-002 | `packages/core/pipeline.ts` | integration `pipeline.int.test.ts` |
| FR-SYS-003 | `packages/availability` (spec 005) | `availability.accuracy.test.ts` |
| FR-SYS-004 | `packages/pricing/tier.ts`, `showPremiumSection` (spec 006) | `tier.test.ts`, `section-visibility.test.ts` |
| FR-SYS-005 | `apps/web/components/price-range` (spec 006) | e2e `price-range.spec.ts` |
| FR-SYS-006 | streaming `POST /api/search` (spec 001, 009) | e2e `streaming.spec.ts` |
| FR-SYS-007 | `jobs/*` + workflows (spec 010) | `jobs/*.test.ts`, workflow dry-run |
| FR-SYS-008 | `packages/jev/fallback.ts`, `packages/core/rank-deterministic.ts` | `degraded-mode.int.test.ts` |
| FR-SYS-009 | `apps/web/app/account`, spec 011 | e2e `account.spec.ts` |
| FR-SYS-010 | `apps/web/app/status`, `job_runs` | e2e `status.spec.ts` |
| FR-SYS-011 | `packages/config` site identity (`NEXT_PUBLIC_SITE_NAME`, `NEXT_PUBLIC_SITE_URL`) | `site-config.test.ts` (no hard-coded hosts in source) |
| NFR-SYS-001 | stage timers in `pipeline.ts` (features event) | `pipeline.perf.test.ts`, prod metrics |
| NFR-SYS-002 | stage timers in `pipeline.ts` (first batch event) | `pipeline.perf.test.ts`, prod metrics |
| NFR-SYS-003 | stage timers in `pipeline.ts` (done event) | `pipeline.perf.test.ts`, prod metrics |
| NFR-SYS-004 | caps in `packages/config` (spec 015) | `budget-guard.test.ts` |
| NFR-SYS-005 | token budget math (spec 002) | monthly usage report |
| NFR-SYS-006 | availability accuracy job (spec 016) | `availability.accuracy.test.ts` |
| NFR-SYS-007 | uptime monitor (spec 015) | uptime report |
| NFR-SYS-008 | UI components (spec 009) | axe-core in Playwright |
| NFR-SYS-009 | responsive layout | Playwright mobile + desktop projects |
| NFR-SYS-010 | status indicator (spec 010) | `status.spec.ts` |

## 14. Risks and research links
- Free-tier limits may change → R-09.
- Jev question count per request unknown → R-01 (design assumes ≤ 50 questions per request).
- Vercel Hobby function duration and SSE behavior → R-09.
