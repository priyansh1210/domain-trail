# Roadmap

| Field | Value |
|---|---|
| Status | Approved (2026-10-03) |
| Last updated | 2026-10-03 |

## How work flows (spec-driven development)

```
spec.md (what/why) ──review──▶ tech.md (how) ──review──▶ tasks.md (small steps) ──▶ code + tests ──▶ verify vs traceability ──▶ release
        ▲                                                                                              │
        └──────────────────────── change requests always start by updating the spec ◀─────────────────┘
```

Review gate: a feature moves forward only when its spec and tech files are marked **Approved** in the README status table.

## Dependency order

```
000 architecture
 └─ 002 Jev ─┬─ 003 features ─┬─ 004 generation ─┐
             │                │                  ├─ 008 ranking ─ 009 UI
 001 intake ─┘                └─ 007 free ───────┤
 012 data ── 005 availability ── 006 pricing ────┘
 010 daily refresh (needs 005, 006, 007, 012) ── 011 accounts & alerts
 013 privacy · 014 abuse · 015 observability · 016 quality · 017 infrastructure  (cross-cutting, start early)
```

## Phases

### Phase 0 — Specifications (done 2026-10-03)
- Deliverables: constitution, glossary, product overview, research list, 18 spec + tech pairs, Jev contract and question catalog, HTTP API contract.
- Exit: owner reviews every spec, answers open questions, and marks specs Approved (or requests changes).

### Phase 1 — MVP (free) — in progress
Scope: 000–010, 012–017, plus from 011: Google/GitHub sign-in (needed for chip editing), saving for everyone
(signed-out saves stored under an anonymous session), watchlist with in-app alerts, and the owner admin view.
No user e-mail (EMAIL_MODE=off). "Dropping soon" moves to phase 2.
- Search flow end-to-end with Jev, generation, DoH + RDAP availability, Porkbun prices (+ Name.com/Dynadot if R-05
  allows), sections Free / $1–100 / $101–300 / $300+ ($300+ hidden when nothing can fill it), price range slider
  $0–$10,000+, currency switcher, reasons, feedback.
- Daily jobs: TLD registry, prices + FX, NRD ingest (if R-07 allows), free providers, brand list, cleanup, backups.
- Privacy/security baseline, limits, budgets, monitoring, CI, evaluation set.
- Exit criteria: golden-set targets met; availability accuracy ≥ 97%; launch checklist complete; $0 bill.

Suggested milestones:

| Milestone | Content | Exit |
|---|---|---|
| M1 Skeleton | monorepo, CI, Supabase schema, env schema, mock mode, deploy pipeline | preview deploy with health check |
| M2 Understand | intake + Jev client + feature detection + chips | features shown < 2 s on golden set |
| M3 Generate & judge | generation + ranking rounds + safety | NDCG@10 ≥ 0.6 offline |
| M4 Verify & price | availability + pricing + free providers + sections + slider | accuracy sample ≥ 97% |
| M5 Freshness & ops | daily jobs, status page, budgets, alerts, backups | 7 days of green jobs |
| M6 Launch | privacy/terms, a11y pass, launch checklist | public launch |

### Phase 2 — Accounts and depth
- "Dropping soon" lists (spec 005 US-5) and alerts; e-mail features only if the owner approves a domain.
- Naming trends from NRD feed into generation; premium-price adapters (R-05); weight tuning from feedback.

### Phase 3 — Expansion
- Aftermarket listings for $300+ (R-06); IDN (non-ASCII) names; UI translations (Hindi first?); public API;
  zone-file based freshness (ICANN CZDS); personalised ranking.

## Owner decisions (2026-10-03)
All reviewer questions are answered; each spec lists its answers in section 10 "Owner decisions". The main ones:
1. Sections are shown only as price ranges; slider goes to $10,000+; a currency switcher covers every supported currency (006).
2. Data region: India / Mumbai (013, 017). Grievance contact: Priyansh K, priyansh1210@gmail.com (013).
3. Repository: public (010, 017).
4. No paid items: stay on the free `*.vercel.app` address; no user e-mail (011 option a, 017).
5. Limits: anonymous 5 per 10 min and 30/day; signed-in 60/day (011, 014).
6. "Dropping soon" ships later, in phase 2 (005).
7. Chip editing for signed-in users only (003). Digits allowed by default; multiple hyphens allowed when enabled (004).
8. Saving works for everyone and is stored in the database; the owner can see saved items in an admin view, disclosed
   in the Privacy Policy (009, 011, 013).
