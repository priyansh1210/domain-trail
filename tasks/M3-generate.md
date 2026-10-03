# Tasks — Milestone M3 · Generate & judge

| Field | Value |
|---|---|
| Milestone | M3 (roadmap) |
| Exit criterion | ranking quality NDCG@10 ≥ 0.6 offline with Jev (≥ 0.4 in degraded mode) on the golden set |
| Specs | 004 (generation), 008 (ranking, reasons), 014 (brand risk), 003 §5.3–5.4 (TLD pool, keyword hints), 016 (evaluation) |
| Started | 2026-10-03 |
| Finished | 2026-10-04 (owner step G1 open) |

Status: ☐ open · ◐ in progress · ☑ done · ⏸ waiting for the owner

Done 2026-10-04 except G1. Measured with the offline mock and with Jev down: NDCG@10 0.989 (mock) and 0.965 (degraded, target 0.4) — see `packages/jev/eval/reports/`. The 0.6 target with the real Jev is measured once the AI Gateway key exists (G1). Caveat: the owner's bad names are easy to spot; harder "plausible but weak" bad names will make the score more honest.

## A. Data and research
| # | Task | Requirement | Status |
|---|---|---|---|
| A1 | `docs/research.md`: R-14 (external datasets: Maikobi used for a smoke pool, website-industry-13m and AYA skipped, with reasons); R-11 updated with the word lists actually used | P1, FR-QA-011 | ☑ |
| A2 | `scripts/build-words.mjs` → committed data: common-word dictionary (ENABLE ∩ WordNet), related words (WordNet), character trigram model, profanity list (LDNOOBW); `NOTICE.md` with attributions | FR-GEN-003, 008, 009, 018 | ☑ |
| A3 | Curated brand seed (well-known brands, spec 014) until the Tranco-based job (M5) | FR-ABU-007 | ☑ |
| A4 | TLD seed: base, geo and feature extensions with short descriptions (spec 003 §5.3) until prices arrive (M4) | FR-FEAT-013 | ☑ |
| A5 | Smoke pool from the Maikobi dataset (≈200 descriptions + 15 harmful + 90 edge cases, Apache-2.0, credited) and a test that runs the pipeline on all of it | FR-QA-004 (supplement) | ☑ |

## B. Keywords — stage S2 (spec 004 §5.1–5.3)
| # | Task | Requirement | Status |
|---|---|---|---|
| B1 | `extractTerms`: lemmas, noun phrases, generic/brand removal, keyword hints, romanization | FR-GEN-001, 017 | ☑ |
| B2 | `weighTerms`: Jev `keyword_core@1` blended with frequency weights; fallback | FR-GEN-002 | ☑ |
| B3 | `relatedWords`: Datamuse (live, ≤ 15 calls, 1.5 s timeout, cache) → offline WordNet fallback; Jev `expansion_fit@1` keeps top 40 | FR-GEN-003, 018, NFR-GEN-002 | ☑ |

## C. Generation — stages S3–S4 (spec 004 §5.4–5.6)
| # | Task | Requirement | Status |
|---|---|---|---|
| C1 | 12 strategies with caps and a seeded random generator (same input → same names) | FR-GEN-004, 005, 012, 013, 014, 016 | ☑ |
| C2 | Prefilter: valid labels, preferences, profanity, brand risk, triple letters, quality ≥ 0.35, de-duplication, ≤ 40 % per style, ≤ 1,000 | FR-GEN-006…011 | ☑ |
| C3 | Quality score Q (length, pronounceability, segmentation, spelling clarity, clean characters) | FR-GEN-008 | ☑ |
| C4 | `brandRisk` (exact, contains, one typo, brand + security word; look-alike characters; strict mode) | FR-ABU-006, 007, 008 | ☑ |
| C5 | `exclude` set for "find more" | FR-GEN-015 | ☑ |

## D. Ranking — stages S5–S6 (spec 008 §5.1–5.6)
| # | Task | Requirement | Status |
|---|---|---|---|
| D1 | TLD pool (≤ 80) and keyword hints from the site profile | FR-FEAT-013 | ☑ |
| D2 | Round 1: `rank_shard@1` over ≤ 4 shards of 250, lift, top 45; deterministic fallback | FR-RANK-001 | ☑ |
| D3 | Round 2: `rank_fit`, `risk_brand`, `risk_negative` (label-only state) × 45 + `tld_fit`; shrinkage, exclusions, preferred boost | FR-RANK-002, 003, 004, 011, 016 | ☑ |
| D4 | Pairing (label × extensions, ≤ 300), final score without the price term until M4, deterministic mode | FR-RANK-005, 006, 014 | ☑ |
| D5 | Reasons that do not depend on price (keyword, excellent fit, short, extension fit, .com, local, brandable, hack) | FR-RANK-010, NFR-RANK-003 | ☑ |

## E. Search flow and page
| # | Task | Requirement | Status |
|---|---|---|---|
| E1 | Run S2–S6 after S1 in `POST /api/search`; progress stages; usage recorded once per search | FR-SYS-002, 006 | ☑ |
| E2 | Temporary `ideas` event and a "Name ideas — not checked yet" list on the results page (top names, suggested extensions, reasons). Replaced by verified results in M4; nothing is labelled "available" | P3, FR-RANK-010 | ☑ |

## F. Evaluation (spec 016 §5.1)
| # | Task | Requirement | Status |
|---|---|---|---|
| F1 | `pnpm eval:pipeline`: ranks each golden example's good + bad names among generated candidates, NDCG@10 and refusal checks; report to `eval/reports/` | FR-QA-005, NFR-RANK-001, 004 | ☑ |
| F2 | Test: degraded (deterministic) ranking reaches NDCG@10 ≥ 0.4 on the golden set | NFR-RANK-004 | ☑ |

## G. Owner steps
| # | Task | Status |
|---|---|---|
| G1 | AI Gateway key (M2 task E2) — needed to measure the ≥ 0.6 target with the real Jev | ⏸ |

## Not in M3
Availability, prices, sections, slider, currency, "find more" button (M4); Google/GitHub sign-in, chip editing,
saving and the admin view (separate milestone once the Supabase project exists, M1 task F3); Datamuse daily cap
counter and meters (M5); feedback buttons (M4 with result cards).
