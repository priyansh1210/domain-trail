# domains-all — Specification Workspace

A website that turns a short description of your website into **available, relevant domain names**, grouped by
budget (**Free · $1–100 · $101–300 · $300+**) with a **price range slider**, explained, and refreshed **daily**.
It uses **Jev** (TypeSafe's decision model) to understand the site and judge names, and runs entirely on
**free plans**.

> **Current phase: 1 — MVP implementation.** M1 (skeleton) is done and live at https://domain-trail.vercel.app;
> M2 (understand the description: Jev client, feature chips) is in review — see [tasks/](tasks/). All specs were
> approved by the owner on 2026-10-03; the answers are recorded in each spec's "Owner decisions" section.
> The project follows **spec-driven development**: `spec.md` = *what* and *why*; `tech.md` = *how*;
> `tasks.md` = the ordered steps to build it.

## How to review (suggested order, ~2–3 hours)
1. [docs/constitution.md](docs/constitution.md) — the 10 rules everything else must follow.
2. [docs/product-overview.md](docs/product-overview.md) — vision, users, journey, feature map.
3. The `spec.md` files in number order (what/why). Answer the **"Open questions for the reviewer"** at the end of each.
4. The `tech.md` files (how) — skim if you prefer; they contain the technical detail for implementation.
5. [docs/research.md](docs/research.md) — facts still to verify, each with a fallback.
6. [docs/roadmap.md](docs/roadmap.md) — phases and the decisions needed from you.

**How to give feedback:** reply with the spec number and your change (e.g. "006: rename 'Mid-range' to 'Standard'",
"014 Q1: raise anonymous limit to 10 per 10 min"). Specs are updated first, then tech files, then tasks.

## Status

| # | Feature | spec.md | tech.md | Extras |
|---|---|---|---|---|
| 000 | [System overview & architecture](specs/000-system-architecture/) | Approved | Approved | |
| 001 | [Website description intake](specs/001-website-description-intake/) | Approved | Approved | |
| 002 | [Jev integration](specs/002-jev-integration/) | Approved | Approved | [Jev contract](specs/002-jev-integration/contracts/jev-systemone.schema.json), [question catalog](specs/002-jev-integration/questions/catalog.md) |
| 003 | [Website feature detection](specs/003-website-feature-detection/) | Approved | Approved | |
| 004 | [Domain name generation](specs/004-domain-name-generation/) | Approved | Approved | |
| 005 | [Domain availability](specs/005-domain-availability/) | Approved | Approved | |
| 006 | [Pricing, sections & range filter](specs/006-pricing-tiers-and-range-filter/) | Approved | Approved | |
| 007 | [Free domain sources](specs/007-free-domain-sources/) | Approved | Approved | |
| 008 | [Ranking & recommendations](specs/008-ranking-and-recommendations/) | Approved | Approved | |
| 009 | [Results experience (UI)](specs/009-results-experience/) | Approved | Approved | [HTTP API contract](specs/009-results-experience/contracts/http-api.openapi.yaml) |
| 010 | [Daily domain data refresh](specs/010-daily-domain-data-refresh/) | Approved | Approved | |
| 011 | [Accounts, saved searches & alerts](specs/011-accounts-saved-searches-alerts/) | Approved | Approved | |
| 012 | [Data management & retention](specs/012-data-management-and-retention/) | Approved | Approved | full DB schema in tech.md |
| 013 | [Privacy, security & compliance](specs/013-privacy-security-compliance/) | Approved | Approved | |
| 014 | [Abuse prevention & rate limits](specs/014-abuse-prevention-and-rate-limits/) | Approved | Approved | |
| 015 | [Observability & cost guard](specs/015-observability-and-cost-guard/) | Approved | Approved | |
| 016 | [Testing & quality](specs/016-testing-and-quality/) | Approved | Approved | |
| 017 | [Infrastructure & deployment](specs/017-infrastructure-and-deployment/) | Approved | Approved | |

## Folder structure

```
README.md                  this file (status + review guide)
docs/
  constitution.md          non-negotiable principles
  product-overview.md      vision, personas, journey, feature map
  glossary.md              domain, data and Jev terms
  research.md              open verification items R-01…R-13
  roadmap.md               phases, milestones, owner decisions
  setup.md                 run locally + free account setup, step by step
  templates/               spec-template.md, tech-template.md
specs/NNN-feature/
  spec.md                  WHAT + WHY (technology-agnostic)
  tech.md                  HOW (stack, data model, interfaces, algorithms, limits, tests, traceability)
  contracts/, questions/   machine-readable contracts where relevant
tasks/                     ordered task lists per milestone (M1-skeleton.md, …)
apps/web/                  the website (Next.js) — pages and API routes
packages/config/           settings, limits and environment validation
packages/core/             intake, feature detection, safety gate, pipeline stages
packages/jev/              Jev decision-model client, question catalog, mock engine, evaluation set
packages/db/               money/time helpers + database schema tests
packages/log/              logger that removes personal data
supabase/                  database migrations and local config
scripts/                   repository checks (trace-check)
.github/workflows/         ci, security, migrate
```

Quick start: `pnpm install` then `pnpm dev` → http://localhost:3000 (details in [docs/setup.md](docs/setup.md)).

## Conventions
- Requirement IDs: `FR-<AREA>-###` (functional), `NFR-<AREA>-###` (non-functional). Area codes: SYS, INT, JEV, FEAT, GEN,
  AVL, PRC, FREE, RANK, UX, REF, ACC, DATA, PRIV, ABU, OBS, QA, INF.
- Keywords: **MUST** (required), **SHOULD** (strongly expected), **MAY** (optional).
- Every requirement appears in its tech.md **traceability matrix** (component + test).
- Money in whole cents with currency; times in UTC.
- Status values: Draft – awaiting review → In review → Approved → Implemented.

## What happens now
1. ~~Specs are updated with your answers and marked **Approved**.~~ Done 2026-10-03.
2. Tasks are written per milestone in [tasks/](tasks/) (small, ordered, testable steps), starting with M1.
3. Code lives next to the docs (see [docs/setup.md](docs/setup.md) for running it locally).
