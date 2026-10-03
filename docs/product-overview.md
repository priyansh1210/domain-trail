# Product Overview

| Field | Value |
|---|---|
| Working name | domains-all (launches on a free `*.vercel.app` address; the name and address are configuration — spec 000 FR-SYS-011) |
| Status | Approved (2026-10-03) |
| Last updated | 2026-10-03 |

## Vision
*Describe your website in one paragraph. Get the best available domain names for it — free and paid, grouped by
budget, explained, and kept fresh every day.*

## The problem
- Good names are hard to find: most obvious ones are taken, and registrar search boxes only check what you type.
- People don't know which extension suits their site (.com? .shop? .in? .dev?).
- Prices are confusing: cheap first year, expensive renewals, premium names, multi-year minimums.
- Free options (subdomains) exist but are scattered and full of conditions.
- Lists and suggestions go stale because new domains are registered every day.

## Who it is for (personas)

| Persona | Situation | What they need most |
|---|---|---|
| **First-time founder / small business** (e.g. a home bakery in Pune) | No technical knowledge, limited budget | Relevant, affordable names; clear prices; local extension options |
| **Developer with a side project** | Wants to ship fast, often free | Free developer subdomains; .dev/.io/.app; short brandable names |
| **Creator / blogger / freelancer** | Personal brand | Personal-name options, .me/.blog/.studio, memorable names |
| **Non-profit / community organizer** | Near-zero budget | Free options, .org/.ngo, honest renewal costs |
| **Agency helping clients** | Many searches, fast shortlisting | Variety, explanations, saved searches and watchlists |

## What makes it different
1. **It understands the site first** — detects type, industry, audience, country, tone and ~40 capabilities, and shows them.
2. **Only verified-available names** — checked against authoritative registry data, with check times shown.
3. **Budget-first presentation** — Free / $1–100 / $101–300 / $300+ sections plus a price range slider.
4. **Honest pricing** — upfront price, renewal price and source on every result.
5. **Fresh every day** — daily refresh of prices, extensions, newly registered names and free providers.
6. **Explained** — every result says why it was chosen.
7. **Private and free** — no account needed, no description stored, no tracking, $0 to run.

## End-to-end journey
1. **Describe** — the visitor writes 1–3 sentences (or picks an example) and optionally sets preferences (spec 001).
2. **Understand** — within ~2 s, chips show what the system detected; the visitor can correct them (spec 003).
3. **Create** — the system generates hundreds of name ideas in many styles (spec 004).
4. **Judge** — Jev ranks the ideas, rates extension fit and removes unsafe or brand-like names (specs 002, 008, 014).
5. **Verify** — availability is checked quickly and politely against registry data (spec 005); free options are checked per provider (spec 007).
6. **Price** — each available name gets its upfront and renewal price and lands in a price section (spec 006).
7. **Choose** — results stream in; the visitor filters by price range (in any currency), reads reasons, and clicks
   Buy (to a registrar), Copy or Save — saving works without an account (spec 009, 011).
8. **Follow up** — signed-in users get daily re-checks and in-app alerts on watched names (spec 011), powered by the
   daily refresh (spec 010).

## Feature map

| Area | Spec |
|---|---|
| Architecture, system requirements | [000](../specs/000-system-architecture/spec.md) |
| Description intake | [001](../specs/001-website-description-intake/spec.md) |
| Jev integration + question catalog | [002](../specs/002-jev-integration/spec.md) |
| Feature detection | [003](../specs/003-website-feature-detection/spec.md) |
| Name generation | [004](../specs/004-domain-name-generation/spec.md) |
| Availability | [005](../specs/005-domain-availability/spec.md) |
| Pricing, sections, range filter | [006](../specs/006-pricing-tiers-and-range-filter/spec.md) |
| Free domains | [007](../specs/007-free-domain-sources/spec.md) |
| Ranking and reasons | [008](../specs/008-ranking-and-recommendations/spec.md) |
| Website UI and API contract | [009](../specs/009-results-experience/spec.md) |
| Daily data refresh | [010](../specs/010-daily-domain-data-refresh/spec.md) |
| Accounts, saved searches, alerts | [011](../specs/011-accounts-saved-searches-alerts/spec.md) |
| Data management and retention | [012](../specs/012-data-management-and-retention/spec.md) |
| Privacy, security, compliance | [013](../specs/013-privacy-security-compliance/spec.md) |
| Abuse prevention and limits | [014](../specs/014-abuse-prevention-and-rate-limits/spec.md) |
| Observability and cost guard | [015](../specs/015-observability-and-cost-guard/spec.md) |
| Testing and quality | [016](../specs/016-testing-and-quality/spec.md) |
| Infrastructure and deployment | [017](../specs/017-infrastructure-and-deployment/spec.md) |

## Key constraints and assumptions
- **$0/month** on free plans (constitution P1). Capacity target ≈ 5,000 uncached searches/month.
- **Jev is a decision model** — it cannot write names, so generation is our own code (constitution P4).
- **Truly free top-level domains barely exist anymore**; the Free section is mostly free subdomains, clearly labelled.
- **$300+ depth depends on data access** (research R-05, R-06); honest explanations when data is missing.
- **E-mail features need the site's own domain** (~$10/year) — start without (spec 011 open question 3).

## Non-goals (phase 1)
Selling/registering domains, hosting, logos, trademark legal checks, non-English UI, public developer API, IDN names.
