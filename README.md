# Domain Trail

**Describe your website, get domain names you can actually buy.** Domain Trail turns a short description into
available, relevant domain names. Each name is checked with the registry that runs its extension and shown with
the real price in the visitor's currency, renewal included. Results are grouped by budget
(**Free · $1–100 · $101–300 · $300+**).

**Live site:** https://domain-trail.vercel.app · Repository and package name: `domains-all` · Runs on free plans
($0 a month).

> **Status (2026-10-11):** phase 1 is live with real sign-in, daily data jobs and weekly encrypted backups. The
> light redesign with the search globe and the new logo are live too. AI answers (the Jev decision model) are
> built for signed-in users. Until Jev credits are bought, searches use the built-in rules. See
> [What is left](#what-is-left).

## What it does
- **One description in, ranked names out.** The site detects what the website is about (type, industry, audience,
  country, tone) and shows the result as editable chips. It then generates names and ranks them, with a short reason
  for each.
- **Checked live.** Every name is checked by DNS and with its registry's RDAP service before it is shown. Taken names
  are never shown, and each result shows when it was checked.
- **Real prices.** Registrar prices are refreshed every morning, with the first-year and renewal prices side by
  side. Prices show in the visitor's currency, using daily exchange rates.
- **Search options.** Preferred extensions are typed into a box with suggestions from about 1,150 extensions.
  The form also has a two-handle price range ($0 to $10,000+), the visitors' country, maximum length, hyphens and
  digits.
- **Free names too.** Free subdomain providers are checked against their public lists of taken names.
- **Accounts (Google or GitHub).** Users can save searches and names, watch a name with in-app alerts, edit the
  detected features, export their data and delete their account. Visitors who are not signed in can still save
  items, under a guest session.
- **AI answers for signed-in users.** A switch on the form lets signed-in users have the Jev decision model read the
  description and rank the names. Visitors who are not signed in see it locked, and their searches send nothing to
  the model. If the model does not answer, the results say so and the built-in rules are used.
- **Open about its data.** The `/status` page shows how old each dataset is. The owner has private `/ops` pages.

## How a search works
1. **Check:** the description is validated, links, e-mails and phone numbers are removed, and the request passes
   the human check (Cloudflare Turnstile) and the rate limits.
2. **Understand:** the built-in rules detect the site's features. For a signed-in user with AI answers on, Jev's
   answers are used as well (spec 002).
3. **Generate and rank:** words from the description become candidate names through several naming strategies.
   Rounds of ranking then judge fit, brand risk and how well each extension suits the site.
4. **Verify:** availability comes from DNS over HTTPS plus RDAP. Prices come from the registrar price list, and the
   names are sorted into price sections.
5. **Stream:** results reach the browser as they are checked. Identical searches within 24 hours reuse the stored
   results.

Scheduled jobs (GitHub Actions) keep the data fresh:
- **Daily:** prices and exchange rates, the extension registry and RDAP directory, newly registered names, free
  providers, watchlist re-checks and clean-up.
- **Weekly:** the popular-site list for the brand check, the Jev evaluation, and an encrypted database backup.
- **Monthly:** an availability accuracy sample, a ranking-weight proposal and a usage report.

## Tech stack
| Part | Choice |
|---|---|
| Website and API | Next.js 16 (App Router), React, Tailwind CSS 4, hosted on Vercel |
| Database and sign-in | Supabase: Postgres and Auth (Google, GitHub, guest sessions) |
| Rate limits and idempotency | Upstash Redis |
| Human check | Cloudflare Turnstile |
| Decision model | Jev (TypeSafe), through an AI gateway; only for signed-in users with AI answers on |
| Data sources | IANA and the RDAP directory, DNS over HTTPS, Porkbun prices, Frankfurter exchange rates, whoisds newly registered names, Majestic Million |
| Jobs and CI | GitHub Actions (CI, security scans, migrations, scheduled jobs) |
| Tooling | pnpm workspaces, Turborepo, TypeScript, Vitest, Playwright, ESLint, Prettier |

The search globe is plain canvas code with no library. The fonts (Manrope, IBM Plex Sans, IBM Plex Mono; OFL) are
served by the site itself.

## Repository layout
```
apps/web/                  the website: pages, API routes, components, e2e tests (Playwright)
packages/
  config/                  settings, limits and environment validation
  core/                    intake, feature detection, safety gate, name generation, ranking, pipeline stages
  jev/                     Jev client, question catalog, budget, circuit breaker, mock engine, evaluation set
  availability/            DNS + RDAP availability checks and their cache
  pricing/                 prices, currencies, price sections and the range slider maths
  free-domains/            free subdomain providers
  db/                      money and time helpers, database schema tests
  email/                   alert digests (switched off: EMAIL_MODE=off)
  metrics/                 owner alerts and budget meters
  log/                     logger that removes personal data
jobs/                      scheduled jobs (prices, registry, NRD, free providers, watchlist, cleanup, backup, …)
supabase/                  database migrations and local config
specs/NNN-feature/         spec.md (what and why) + tech.md (how), contracts where relevant
tasks/                     ordered task lists per milestone (M1 … M8)
docs/                      constitution, product overview, roadmap, setup, launch checklist, runbooks, security
scripts/                   repository checks (trace-check) and data snapshots
.github/workflows/         CI, security, migrate, scheduled jobs, backups
```

## Run it locally
You need Node.js 22 and pnpm. Without any accounts or keys, the site runs in **mock mode** with recorded data.

```bash
pnpm install
pnpm dev                 # http://localhost:3000 (check /api/health → "mode":"mock")
```

| Command | What it does |
|---|---|
| `pnpm check` | everything CI checks: lint, format, typecheck, unit tests, traceability |
| `pnpm test` | unit and integration tests for every package |
| `pnpm build` | production build |
| `pnpm --filter @domains-all/web test:e2e` | end-to-end tests on desktop and phone (run `pnpm build` first; the tests start the built site) |
| `pnpm trace:check` | every requirement in the specs has exactly one traceability row |

The full guide, including the free accounts for going live, is in [docs/setup.md](docs/setup.md).

## How we work
- **Spec first.** Each feature has a `spec.md` (what and why, no technology names) and a `tech.md` (how). The owner
  approves a spec before code is written. Requirement IDs are `FR-<AREA>-###` and `NFR-<AREA>-###`. Every ID has
  exactly one row in its tech.md traceability matrix, linking it to a component and a test (`pnpm trace:check`).
- **Branches and pull requests.** `main` is protected. Work happens on a branch and lands through a pull request
  with green CI, squash-merged.
- **Secrets.** Secrets live only in Vercel and in the GitHub environments (`production`, `jobs`), never in the
  repository or in `.env` files. Secret keys are never put in `NEXT_PUBLIC_*` variables. The backup private key is
  kept offline.
- **Free first.** Any paid service needs the owner's approval.
- **Site identity is configuration.** The site's name and address come only from `NEXT_PUBLIC_SITE_NAME` and
  `NEXT_PUBLIC_SITE_URL`, and a test fails if they are hard-coded (FR-SYS-011).

## Milestones
| Milestone | What | State |
|---|---|---|
| M1 Skeleton | monorepo, CI, schema, mock mode, deploy | done |
| M2 Understand | intake, Jev client, feature chips | done |
| M3 Generate & judge | name generation, ranking rounds, safety | done; the real-Jev quality score waits for Jev credits |
| M4 Verify & price | availability, prices, free names, sections, slider | done; the registrar accuracy check waits for the Porkbun account |
| M5 Freshness & ops | daily jobs, Status page, budgets, alerts, backups | done; jobs and backups running |
| M5b Accounts | sign-in, saving, watchlist, chip editing, `/ops` | done; live since 2026-10-11 |
| M6 Launch | policies, accessibility, monitoring, launch checklist | in progress |
| M7 Redesign | light design, logo, search globe, extension box, price range | done (#22–#24) |
| M8 AI answers | AI answers only for signed-in users who switch them on | done (#25) |

## What is left
- **Jev credits.** Once Jev credits are bought, signed-in users with AI answers on get model answers, with no code
  change needed. Until then, they see the "decision model is unavailable" notice.
- **Launch checklist** ([docs/launch-checklist.md](docs/launch-checklist.md)):
  - final checks on the live site;
  - monitoring: Sentry, UptimeRobot and Cloudflare Web Analytics, all free;
  - a read-through of the Privacy Policy and Terms.
- **Accuracy check.** The monthly registrar check needs a Porkbun API key, which waits for the account's ID
  verification.

Planned later ([docs/roadmap.md](docs/roadmap.md)):
- **Phase 2:** "Dropping soon" lists, naming trends from newly registered names, more price sources.
- **Phase 3:** aftermarket listings, non-ASCII names, translations, a public API.

## Specs
| # | Spec | Extras |
|---|---|---|
| 000 | [System overview & architecture](specs/000-system-architecture/) | |
| 001 | [Website description intake](specs/001-website-description-intake/) | |
| 002 | [Jev integration](specs/002-jev-integration/) | [Jev contract](specs/002-jev-integration/contracts/jev-systemone.schema.json), [question catalog](specs/002-jev-integration/questions/catalog.md) |
| 003 | [Website feature detection](specs/003-website-feature-detection/) | |
| 004 | [Domain name generation](specs/004-domain-name-generation/) | |
| 005 | [Domain availability](specs/005-domain-availability/) | |
| 006 | [Pricing, sections & range filter](specs/006-pricing-tiers-and-range-filter/) | |
| 007 | [Free domain sources](specs/007-free-domain-sources/) | |
| 008 | [Ranking & recommendations](specs/008-ranking-and-recommendations/) | |
| 009 | [Results experience (UI)](specs/009-results-experience/) | [HTTP API contract](specs/009-results-experience/contracts/http-api.openapi.yaml) |
| 010 | [Daily domain data refresh](specs/010-daily-domain-data-refresh/) | |
| 011 | [Accounts, saved searches & alerts](specs/011-accounts-saved-searches-alerts/) | |
| 012 | [Data management & retention](specs/012-data-management-and-retention/) | full database schema in tech.md |
| 013 | [Privacy, security & compliance](specs/013-privacy-security-compliance/) | |
| 014 | [Abuse prevention & rate limits](specs/014-abuse-prevention-and-rate-limits/) | |
| 015 | [Observability & cost guard](specs/015-observability-and-cost-guard/) | |
| 016 | [Testing & quality](specs/016-testing-and-quality/) | |
| 017 | [Infrastructure & deployment](specs/017-infrastructure-and-deployment/) | |

All specs were approved by the owner on 2026-10-03. Later owner decisions are recorded in each spec's "Owner
decisions" sections.

## Documents
- [docs/constitution.md](docs/constitution.md): the rules everything else follows.
- [docs/product-overview.md](docs/product-overview.md): vision, users, journey and feature map.
- [docs/glossary.md](docs/glossary.md): domain, data and Jev terms.
- [docs/roadmap.md](docs/roadmap.md): phases, milestones and owner decisions.
- [docs/research.md](docs/research.md): facts checked or still to check.
- [docs/setup.md](docs/setup.md): run locally, then the free accounts for going live.
- [docs/launch-checklist.md](docs/launch-checklist.md): the steps before announcing the site.
- [docs/runbooks/](docs/runbooks/): deploy, rollback, restore a backup, rotate secrets, re-run a job, incidents.
- [docs/security/asvs-l1.md](docs/security/asvs-l1.md): security checklist.

## Conventions
- **Keywords:** **MUST** (required), **SHOULD** (strongly expected), **MAY** (optional).
- **Area codes:** SYS, INT, JEV, FEAT, GEN, AVL, PRC, FREE, RANK, UX, REF, ACC, DATA, PRIV, ABU, OBS, QA, INF.
- **Units:** money in whole cents with its currency; times in UTC.
