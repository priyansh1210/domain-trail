# Tasks — Milestone M1 · Skeleton

| Field | Value |
|---|---|
| Milestone | M1 (roadmap) |
| Exit criterion | preview deployment answers `GET /api/health` |
| Specs | 000, 012, 013 (baseline), 016 (CI), 017 |
| Started | 2026-10-03 |

Status: ☐ open · ◐ in progress · ☑ done · ⏸ waiting for the owner

Verified locally on 2026-10-03: `pnpm lint`, `pnpm format:check`, `pnpm typecheck`, `pnpm test` (42 tests),
`pnpm trace:check`, `pnpm build`, and `next start` → `GET /api/health` = 200 `{ok:true, mode:"mock"}` with the
security headers. E2 (real Supabase stack in CI) is written but first runs on GitHub — Docker was not running here.

## A. Repository and tooling (spec 000 §3, 017 §5.4)
| # | Task | Requirement | Status |
|---|---|---|---|
| A1 | `git init`, `.gitignore`, `.gitattributes` (LF), `.editorconfig`, `.nvmrc` (Node 22) | FR-INF-006 | ☑ |
| A2 | pnpm workspace (`apps/*`, `packages/*`) + Turborepo pipeline (`build`, `lint`, `typecheck`, `test`) | ADR-001 | ☑ |
| A3 | Shared `tsconfig.base.json` (strict), ESLint flat config, Prettier | spec 016 §1 | ☑ |
| A4 | `.env.example` with every variable from spec 017 §4 (names + comments, no values) | FR-INF-005 | ☑ |

## B. Configuration (spec 000 §6)
| # | Task | Requirement | Status |
|---|---|---|---|
| B1 | `packages/config`: zod-validated env (`MOCK_EXTERNALS` defaults to on), site identity | FR-INF-005, FR-SYS-011 | ☑ |
| B2 | `packages/config/defaults.ts`: limits, TTLs, sections, slider, caps taken from the approved specs | P8 | ☑ |
| B3 | `site-config.test.ts`: no hard-coded host names in source | FR-SYS-011 | ☑ |

## C. Web app (spec 009, 013, 015)
| # | Task | Requirement | Status |
|---|---|---|---|
| C1 | `apps/web`: Next.js App Router + Tailwind; placeholder home page reading the site name from config | FR-SYS-011 | ☑ |
| C2 | `GET /api/health` per the OpenAPI contract (`ok, db, upstash, jevBreaker, version, mode`), 30 s cache, no secrets | FR-OBS-006 | ☑ |
| C3 | Baseline security headers (HSTS, frame protection, referrer, permissions, nosniff); full CSP comes in M6 | FR-PRIV-011 | ☑ |
| C4 | `packages/log`: structured logger that redacts description / e-mail / IP / tokens | FR-PRIV-004 | ☑ |

## D. Database (spec 012, 011)
| # | Task | Requirement | Status |
|---|---|---|---|
| D1 | `supabase/config.toml` (anonymous sign-ins, manual linking, Google/GitHub providers via env) | FR-ACC-002, FR-ACC-017 | ☑ |
| D2 | Migration `init`: full v1 schema (reference, caches, searches, feedback, user data incl. `anon_visitors`, ops), RLS on every table, RPCs | FR-DATA-001…012 | ☑ |
| D3 | `packages/db`: migration test in an in-process Postgres (PGlite) with Supabase `auth` stubs; schema guard (no description in `searches`, RLS everywhere, money in cents) | FR-DATA-002, 004, 006 | ☑ |
| D4 | `packages/db`: money/time helpers (cents + currency, UTC) | FR-DATA-006 | ☑ |

## E. CI and deployment (spec 016, 017)
| # | Task | Requirement | Status |
|---|---|---|---|
| E1 | `ci.yml`: install → lint → typecheck → unit tests → build; `trace:check` (report-only) | FR-QA-002 | ☑ |
| E2 | `ci.yml` job `db`: Supabase CLI local stack applies all migrations (real Supabase, complements D3) | FR-DATA-007 | ◐ |
| E3 | `security.yml`: gitleaks + CodeQL (free on public repos) | FR-PRIV-013, FR-INF-014 | ☑ |
| E4 | `migrate.yml`: `supabase db push` on `main`, gated by the `production` environment (owner approval) | FR-INF-004 | ☑ |
| E5 | `scripts/trace-check.mjs`: every FR/NFR ID present once in its tech matrix | FR-QA-001 | ☑ |

## F. Owner steps (cannot be done by code)
| # | Task | Status |
|---|---|---|
| F1 | Create the public GitHub repository and push (`docs/setup.md` step 1) — github.com/priyansh1210/domain-trail | ☑ |
| F2 | Import the repo into Vercel (root `apps/web`, region `bom1`) → first preview deploy → open `/api/health` | ⏸ |
| F3 | Create the Supabase project in Mumbai (`ap-south-1`) and enable Google/GitHub + anonymous sign-ins | ⏸ |

## Not in M1 (later milestones)
MSW fixtures and external clients (M2+), Jev client and breaker (M2 — health reports `jevBreaker: closed` until then),
Upstash limiter (M2), UI components (M2–M4), daily jobs (M5), CSP with nonces, policies, launch checklist (M6).
