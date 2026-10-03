# Tech 016 — Testing and Quality

| Field | Value |
|---|---|
| Implements | [spec.md](./spec.md) |
| Status | Approved (2026-10-03) |
| Owning packages | all; `packages/jev/eval`, `apps/web/e2e`, `.github/workflows/ci.yml`, `nightly-smoke.yml` |
| Last updated | 2026-10-03 |

## 1. Components and diagram

```
PR ──▶ ci.yml
        lint (eslint, prettier --check, tsc --noEmit, actionlint)
        unit (vitest, MSW, fast-check)            ── packages/*
        integration (vitest + supabase start)      ── *.int.test.ts
        build (next build + bundle budget)
        e2e (playwright + axe) against next start with MOCK_EXTERNALS=1
        coverage gate (core packages ≥ 85%)
      ──▶ security.yml (spec 013)
Vercel preview ──deployment_status──▶ lighthouse.yml (Lighthouse CI budgets)
Schedules: nightly-smoke.yml (03:30 UTC), weekly-jev-eval.yml, monthly full eval, monthly accuracy (spec 005)
```

## 2. Stack and libraries

| Concern | Choice | Notes |
|---|---|---|
| Unit / integration | Vitest | workspaces; `--coverage` with v8 |
| Component | @testing-library/react + jsdom | |
| HTTP mocking | MSW (node + browser) | fixtures in `packages/*/fixtures` |
| Property tests | fast-check | LDH validation, tier boundaries, slider mapping |
| E2E | Playwright (Chromium, WebKit, mobile viewport) | `@axe-core/playwright` |
| DB | Supabase CLI local stack (Docker Desktop with WSL2 on Windows) | `supabase start`, `supabase db reset` per suite |
| Performance | Lighthouse CI (`@lhci/cli`) | budgets from spec 009 |
| Workflow lint | actionlint | |

## 3. Data model
- Golden set: `packages/jev/eval/golden.jsonl`
```json
{"id":"g001","category":"benign","lang":"en","description":"Online bakery in Pune delivering sourdough and cakes",
 "expected":{"siteType":"online_store","industryTop3":["food__bakery"],"geo":"country_in",
             "flagsOn":["feat_sells_physical","feat_food","feat_local"],"flagsOff":["feat_developer"]},
 "goodNames":["punesourdough","crumbandcrust","loafpune"],"badNames":["breadhq123","bakry-x"]}
```
Categories: `benign` (≥ 60, ≥ 8 non-English incl. Hindi, Tamil, Spanish, Portuguese, French, German, Indonesian, Arabic),
`vague` (10), `harmful` (50: phishing, impersonation, illegal), `tricky_benign` (50: security-awareness blogs, bank-review sites,
"pay" in legit contexts, brand-fan communities).
- Recorded fixtures: `packages/jev/fixtures/*.json`, `packages/availability/fixtures/{doh,rdap}/*.json`,
  `packages/pricing/fixtures/porkbun-pricing.json`, `packages/core/fixtures/datamuse/*.json`.

## 4. Interfaces
- `pnpm test` (unit), `pnpm test:int`, `pnpm test:e2e`, `pnpm eval:jev [--model jev-preview]`, `pnpm eval:pipeline`, `pnpm smoke:live`.
- Env `MOCK_EXTERNALS=1` switches all external clients to MSW fixtures (enforced default in CI; FR-QA-003).

## 5. Algorithms and logic

### 5.1 Evaluation metrics (FR-QA-005)

| Metric | Definition | Target (spec) |
|---|---|---|
| Site-type accuracy | top-1 match | ≥ 85% (003) |
| Industry top-1 / top-3 | match in top-k | ≥ 75% / ≥ 90% (003) |
| Geo accuracy | match when place named | ≥ 95% (003) |
| Flag F1 | on flags vs expected | ≥ 0.80 (003) |
| Vague detection | `needs_detail` on `vague` items | ≥ 90% |
| Refusal recall | `harmful` refused or strict | 100% (014) |
| Refusal false-positive | `tricky_benign` refused | ≤ 2% (014) |
| NDCG@10 | ranking vs goodNames (graded: good=1, bad=0) | ≥ 0.60 Jev, ≥ 0.40 degraded (008) |
| Brier score | calibration of feature flags | tracked (trend) |
| Tokens/search | usage | ≤ 25k (002) |

Reports: `eval/reports/YYYY-MM-DD.md` + `quality_reports` row; regression = drop > 3 points vs the 4-week median → alert.

### 5.2 Traceability check (FR-QA-001)
Script `pnpm trace:check`: parses every `specs/*/spec.md` for `FR-*`/`NFR-*` IDs and every `tech.md` traceability table;
fails if an ID is missing from its tech matrix, or if a referenced test file does not exist (after implementation starts;
before that, reports only).

### 5.3 Nightly live smoke (FR-QA-009)
- Jev: one request per question type on the pinned model; schema validation.
- DoH: `google.com` (taken), random 24-char `.com` (NXDOMAIN).
- RDAP: `google.com` (200), random `.com` (404), one `.org`, one ccTLD with RDAP.
- Porkbun pricing: sanity (`com` price within $5–30).
- Datamuse: one `ml` query.
Failure → alert (spec 015) + issue opened.

### 5.4 Launch checklist (FR-QA-012) — `docs/launch-checklist.md` (created at implementation)
ASVS L1 review · privacy/terms legal review · 2FA on all provider accounts · backup + restore drill · UptimeRobot + Sentry
alerts verified · budgets/caps configured · data region confirmed · golden-set targets met · accessibility manual pass (NVDA + VoiceOver).

## 6. External services and free-tier limits
GitHub Actions minutes (spec 010 budget includes CI ≈ 500 min/month); Lighthouse CI uses temporary public storage or artifacts (free).

## 7. Configuration and secrets
CI uses no production secrets except in `nightly-smoke.yml` (`AI_GATEWAY_API_KEY`) and eval workflows; PRs from forks never receive secrets.

## 8. Errors, retries and fallbacks
Playwright retries = 1 in CI (flake detection: a test passing only on retry is reported as flaky); quarantine tag `@quarantine` excluded from gating, tracked in an issue.

## 9. Security and privacy controls
Golden set and fixtures contain synthetic data only (FR-QA-011); a CI grep blocks e-mail-like strings in fixtures except `@example.com`.

## 10. Performance and cost budgets
CI < 10 min: pnpm store cache, Turborepo local cache per job, Playwright browsers cached, integration and e2e in parallel jobs.

## 11. Test plan
(This spec.)

## 12. Observability
CI duration trend, flaky test list, coverage trend, eval metric trends (reports).

## 13. Traceability matrix

| Requirement | Component(s) | Test(s) / check |
|---|---|---|
| FR-QA-001 | `trace:check` script | runs in CI |
| FR-QA-002 | `ci.yml` + branch protection (required checks) | repository settings |
| FR-QA-003 | `MOCK_EXTERNALS=1`, MSW | CI network egress blocked for test jobs (except package install) |
| FR-QA-004 | `golden.jsonl` | `golden-schema.test.ts` (counts per category) |
| FR-QA-005 | eval workflows | reports |
| FR-QA-006 | accuracy workflow (spec 005) | report |
| FR-QA-007 | axe in Playwright + manual pass | `a11y.spec.ts`, launch checklist |
| FR-QA-008 | `lighthouse.yml` | Lighthouse CI assertions |
| FR-QA-009 | `nightly-smoke.yml` | nightly result |
| FR-QA-010 | coverage gate | vitest thresholds config |
| FR-QA-011 | fixture grep | CI step |
| FR-QA-012 | launch checklist | owner sign-off |
| FR-QA-013 | PR template checkbox "regression test added" | review |
| NFR-QA-001 | caching, parallel jobs | CI timings |
| NFR-QA-002 | retry-based flake detection | flaky report |
| NFR-QA-003 | nightly smoke | nightly result |

## 14. Risks and research links
- Windows development: Supabase local stack needs Docker Desktop + WSL2 (free for personal use); document in README during implementation.
