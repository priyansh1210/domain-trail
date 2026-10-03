# Tasks — Milestone M4 · Verify & price

| Field | Value |
|---|---|
| Milestone | M4 (roadmap) |
| Exit criterion | availability accuracy sample ≥ 97 % ("available" names really free at a registrar) |
| Specs | 005 (availability), 006 (pricing, sections, slider, currency), 007 (free sources), 009 (results page), 008 §5.5–5.7 (price term, sections), 014 (re-check/feedback limits) |
| Started | 2026-10-04 |

Status: ☐ open · ◐ in progress · ☑ done · ⏸ waiting for the owner

**2026-10-04: built and tested except the accuracy measurement (H1), which needs the owner's free Porkbun API key (I1).** A dry run of `pnpm eval:availability --dry-run` on 3 golden examples checked 136 names live (57 available, 38 taken, 39 likely available, 2 unknown). Tests: availability 21, pricing 24, free names 14, core verify 5, web endpoints 6 + results logic 7; 44 end-to-end tests on desktop and mobile. Results-page JavaScript: 174 KiB compressed.

## Decisions for this milestone (2026-10-04)
1. **Real public data even in mock mode.** DNS-over-HTTPS, RDAP, Porkbun's public price list and Frankfurter rates are
   free and need no key, so the site uses them for real (`PUBLIC_DATA_MODE=live`, the default). Tests and CI use
   recorded fixtures (`PUBLIC_DATA_MODE=fixture`). Paid or keyed services (Jev, Supabase, Upstash, Turnstile) keep
   following `MOCK_EXTERNALS`. Reason: P3 — a simulated "available" on the public site would be dishonest.
2. **Jev stays off for now** (owner, 2026-10-04: stay free, decide about a small credit before launch). Searches use the
   deterministic fallback with the "AI judge unavailable" banner (degraded mode).
3. **No database needed for M4 data.** Prices and the RDAP directory are fetched by the server at most every 12 hours
   and kept in memory, with committed snapshots as fallback; the availability cache is in memory, or in
   `domain_checks` when Supabase is configured. Daily jobs that write these tables come in M5 (spec 010).
4. **Deferred:** extra registrars as price/premium sources (R-05, needs accounts), newly-registered-domain data
   (R-07, M5), resale listings (R-06, phase 3), "Dropping soon" (phase 2).

## A. Research
| # | Task | Requirement | Status |
|---|---|---|---|
| A1 | R-03: IANA RDAP directory (1,203 TLDs; none for .io .co .us .me .de .jp → "likely available"), default 5 req/s per registry host, DoH fair use | FR-AVL-007, 008 | ☑ |
| A2 | R-04: Porkbun `pricing/get` — public, no auth, 911 TLDs in USD, no stated limits or display restrictions; shown as "Price from Porkbun" with a plain link | FR-PRC-001, 017 | ☑ |
| A3 | R-08: free providers (is-a.dev, js.org, eu.org, pp.ua, DigitalPlat, pages.dev, vercel.app, netlify.app, github.io) — status, eligibility, permitted checks | FR-FREE-001, 010 | ☑ |
| A4 | R-09: Vercel Hobby functions run up to 300 s with streaming (enough); Frankfurter moved to `api.frankfurter.dev/v1` | NFR-AVL-003 | ☑ |
| A5 | R-13: policies for the extensions in our pool — minimum years, restrictions, HTTPS-only, premium names | FR-PRC-002, 014 | ☑ |

## B. Reference data
| # | Task | Requirement | Status |
|---|---|---|---|
| B1 | RDAP directory snapshot (TLD → base URL) from the IANA file + loader that refreshes it every 12 h | FR-AVL-001 | ☑ |
| B2 | Extension policy seed (min years, restriction + note, HTTPS-only, premium names) for every pool TLD | FR-PRC-002, 012, 014 | ☑ |
| B3 | Porkbun price snapshot + FX snapshot (fixtures and offline fallback) | FR-PRC-011 | ☑ |
| B4 | Free provider seed (`free_providers.json`) with steps, waiting time, eligibility, check method | FR-FREE-001, 009 | ☑ |

## C. Availability — `packages/availability` (spec 005)
| # | Task | Requirement | Status |
|---|---|---|---|
| C1 | DoH NS check (Cloudflare → Google fallback, wildcard skip) | FR-AVL-002 | ☑ |
| C2 | RDAP lookup (404 available, 200 taken / dropping soon, 429 Retry-After, 5xx retry, timeouts, size limit) | FR-AVL-001, 003, 008 | ☑ |
| C3 | Politeness: per-host token buckets with adaptive halving, per-search caps (400 DoH, 120 RDAP), daily caps | FR-AVL-007, 013, NFR-AVL-006 | ☑ |
| C4 | Shared cache with freshness windows (memory; `domain_checks` when Supabase is configured) | FR-AVL-005, 009 | ☑ |
| C5 | `checkMany` streaming results within a deadline; `recheckOne` | FR-AVL-006, 014 | ☑ |
| C6 | Fixture checker for tests (recorded DoH/RDAP answers) | NFR-QA | ☑ |

## D. Pricing — `packages/pricing` (spec 006)
| # | Task | Requirement | Status |
|---|---|---|---|
| D1 | Porkbun adapter (parse, sanity checks, buy link) and Frankfurter adapter | FR-PRC-001, 010, 017 | ☑ |
| D2 | `priceFor` (lowest source, min-years upfront, renewal warning, premium possible, unpriced) | FR-PRC-002, 012, 015, 016 | ☑ |
| D3 | `tierOf`, section visibility and labels per currency | FR-PRC-003 | ☑ |
| D4 | Slider scale ($0 … $10,000+, 1-2-5 steps) and `tldsInBand` | FR-PRC-004, 009 | ☑ |
| D5 | In-memory price/FX snapshot refreshed every 12 h, data age, stale warning after 30 h | FR-PRC-011, NFR-PRC-002 | ☑ |

## E. Free names — `packages/free-domains` (spec 007)
| # | Task | Requirement | Status |
|---|---|---|---|
| E1 | `selectProviders` by site profile; label variants for platform addresses | FR-FREE-002, 006 | ☑ |
| E2 | Checks: DoH for platform/subdomain services where permitted, otherwise "not verifiable" | FR-FREE-003, 010 | ☑ |
| E3 | Ranking (relevance, provider fit, check confidence), top 15, ≤ 5 per provider; conditions | FR-FREE-004, 007 | ☑ |

## F. Search flow and API
| # | Task | Requirement | Status |
|---|---|---|---|
| F1 | Stages S7–S9 after ranking: check the top pairs, price them, place them in sections; `batch`, `notice`, `done` counts; replaces the temporary `ideas` event | FR-AVL-006, FR-PRC-003, FR-SYS-002 | ☑ |
| F2 | Free section in parallel with S7 | NFR-FREE-001 | ☑ |
| F3 | Results stored with the search (snapshot + replay for shared links) | FR-UX-006 | ☑ |
| F4 | `POST /api/domains/{fqdn}/recheck` (10/min per visitor) | FR-AVL-014 | ☑ |
| F5 | `POST /api/search/{ref}/more` — more names in a price band, excluding shown ones | FR-PRC-009 | ☑ |
| F6 | `POST /api/feedback` — thumbs up/down (rate-limited) | FR-RANK-012 | ☑ |
| F7 | OpenAPI contract updated (batch, notice, more, recheck, feedback; `ideas` removed) | spec 009 | ☑ |

## G. Results page (spec 009)
| # | Task | Requirement | Status |
|---|---|---|---|
| G1 | Result card: name, status + check time, prices + source, badges, reasons, Buy / Copy / Re-check / thumbs | FR-UX-004 | ☑ |
| G2 | Sections Free · $1–100 · $101–300 · $300+ · Price at registrar with counts; list on desktop, tabs on phones | FR-UX-002, 003, FR-PRC-003 | ☑ |
| G3 | Filter bar: two-handle range ($0–$10,000+), typed min/max, presets, basis toggle, currency, sort; kept in the URL | FR-PRC-004…008, 010, FR-UX-018 | ☑ |
| G4 | Free section with the "Free hosting addresses" group and conditions | FR-FREE-004, 008, 011 | ☑ |
| G5 | Progress stages, banners (degraded, checks paused, stale prices), disclaimer, empty states, polite announcements | FR-UX-005, 008, 009, 013, 017 | ☑ |
| G6 | End-to-end and accessibility tests; results-page JS budget < 250 KB | NFR-UX-004, 005 | ☑ |

## H. Accuracy (exit criterion)
| # | Task | Requirement | Status |
|---|---|---|---|
| H1 | Accuracy check: sample "available" and "taken" results and compare with a registrar check (Porkbun bulk `checkDomain`, 200 names/min) — workflow `monthly-availability-accuracy.yml` | FR-AVL-012, NFR-AVL-001/002 | ⏸ |

## I. Owner steps
| # | Task | Status |
|---|---|---|
| I1 | Free Porkbun account → API key + secret as GitHub secrets (`PORKBUN_API_KEY`, `PORKBUN_SECRET_KEY`) for the accuracy check | ☐ |
| I2 | Before announcing the site: Cloudflare Turnstile and Upstash Redis (both free) so real checks are protected from bots | ☐ |

## Not in M4
Daily jobs writing prices, the RDAP directory and free-provider data to the database (M5); status page (M5);
sign-in, saving and the admin view (after M4, Supabase now exists); "Dropping soon" (phase 2); extra registrars and live
premium checks (R-05); resale listings (R-06).
