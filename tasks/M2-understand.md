# Tasks — Milestone M2 · Understand

| Field | Value |
|---|---|
| Milestone | M2 (roadmap) |
| Exit criterion | detected features (chips) shown < 2 s after submit on the golden set |
| Specs | 001, 002, 003, 009 (results shell), 014 (human check, limits, safety gate), 012 (search rows) |
| Started | 2026-10-03 |

Status: ☐ open · ◐ in progress · ☑ done · ⏸ waiting for the owner

Verified locally on 2026-10-03: lint, format, typecheck, 141 unit/integration tests (config 12, log 4, db 21, jev 35,
core 49, web 20), `trace:check`, production build, and 26 Playwright journeys (desktop + mobile, axe) in mock mode.
Chips appear ~0.2 s after submit with the mock decision model; the < 2 s check against the real Jev needs the AI
Gateway key (E2). Home page JavaScript: 136 KiB gzip / 117 KiB brotli (budget 150 KB, NFR-INT-004).

## A. Housekeeping
| # | Task | Requirement | Status |
|---|---|---|---|
| A1 | Pin `@types/node` to Node 22 (runtime), Vercel runtime `22.x`; keep TypeScript 6 (record in tech 000); Dependabot ignores major bumps of both | spec 000 §2 | ☑ |
| A2 | Fix tech 001 §9 body limit (8 KB → 16 KB, matches spec 014 FR-ABU-009) | FR-ABU-009 | ☑ |

## B. Jev client — `packages/jev` (spec 002)
| # | Task | Requirement | Status |
|---|---|---|---|
| B1 | Types + full v1 question catalog as code (S1, S2, S5, S6), `id@version` | FR-JEV-002 | ☑ |
| B2 | `catalog-sync.test.ts`: code catalog ↔ `questions/catalog.md` (ids, versions, types, option counts) | FR-JEV-002 | ☑ |
| B3 | Answer validation per type (choice keys, probability sums, score range) | FR-JEV-004 | ☑ |
| B4 | Batcher (≤ 50 questions, token limits, parallel groups) | FR-JEV-012 | ☑ |
| B5 | Transport: gateway/direct route, timeout + stage deadline, retries with backoff on 429/529/5xx, none on 401/422, request-id logging | FR-JEV-005, 006, 010, 011 | ☑ |
| B6 | Circuit breaker (5 failures / 60 s → open 30 s → half-open probe) | FR-JEV-007 | ☑ |
| B7 | Budget guard: daily/monthly caps before sending, usage recorded per search (store interface; DB RPC `jev_usage_add`) | FR-JEV-008, 009 | ☑ |
| B8 | `buildState` whitelist + `state-privacy.test.ts` | FR-JEV-013 | ☑ |
| B9 | Mock engine for `MOCK_EXTERNALS=1`: contract-valid answers without network; `contract.test.ts` against the JSON schema | FR-JEV-014 | ☑ |
| B10 | Per-search answer memo | FR-JEV-017 | ☑ |

## C. Intake and features — `packages/core` (spec 001, 003, 014)
| # | Task | Requirement | Status |
|---|---|---|---|
| C1 | Request/preference schemas (2,000 chars, digits on by default), `normalize()` with removal flags, cache key, `/s/{id}.{hmac8}` links, UUIDv7 ids | FR-INT-002, 004, 005, 007, 008, 011, 013 | ☑ |
| C2 | ≥ 6 globally neutral examples | FR-INT-003 | ☑ |
| C3 | Industry taxonomy seed (≤ 200 entries: label, keywords, wordHints, tldHints) + flag keywords + country gazetteer | FR-FEAT-002, 014 | ☑ |
| C4 | `interpretFeatures`: thresholds, unsure marking, alternatives, preference overrides, sensitive categories | FR-FEAT-001…010, 012, 015 | ☑ |
| C5 | Rule-based fallback (wink-nlp) ≥ 60% site type on samples | FR-FEAT-014, NFR-FEAT-006 | ☑ |
| C6 | Safety gate (refuse / strict brand) + keyword fallback | FR-ABU-005, 006 | ☑ |
| C7 | Stage S1 runner → events `features` / `needs_detail` / `refused` / `degraded` | FR-SYS-006, FR-FEAT-009 | ☑ |

## D. Website (spec 001, 009, 014)
| # | Task | Requirement | Status |
|---|---|---|---|
| D1 | `POST /api/search`: 16 KB cap, validation, Turnstile (skipped in mock mode), rate limits (Upstash + in-memory fallback), idempotency, cache lookup, event stream | FR-INT-006, 008, FR-ABU-001, 002, 009, 011, 012 | ☑ |
| D2 | Search store: Supabase (search rows, features, cache index; never the description) + in-memory store for mock mode; `GET /api/search/{ref}` snapshot | FR-INT-012, FR-DATA-002, FR-UX-006 | ☑ |
| D3 | Home page: description form, counter, examples, preferences panel, keyboard/screen-reader friendly | FR-INT-001, 003, 004, 014, FR-UX-001 | ☑ |
| D4 | Results page shell: progress stages, feature chips (unsure marking, alternatives; read-only until sign-in exists), "add more detail" prompt with "Search anyway", refusal and degraded banners | FR-FEAT-010, FR-INT-009, FR-UX-005, 009 | ☑ |
| D5 | Playwright e2e (mock mode) + axe: intake, chips before names, vague prompt, refusal; CI job | FR-QA-007, NFR-SYS-001 | ☑ |

## E. Owner steps
| # | Task | Status |
|---|---|---|
| E1 | Review/label the starter golden set (`packages/jev/eval/golden.jsonl`) — done 2026-10-03: 20 normal examples confirmed, good/bad names for all 30 normal + tricky rows; grows to 170 before launch (M6) | ☑ |
| E2 | Create the Vercel AI Gateway key (`docs/setup.md` step 3) so the live Jev check and timing can run | ⏸ |

## Not in M2
TLD pool and keyword hints (M3, need generation), chip editing via `/refine` + Google/GitHub sign-in (M3, needs
the S2–S9 pipeline), weekly evaluation workflow (M5), Sentry (M5).
