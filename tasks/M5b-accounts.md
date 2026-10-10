# Tasks — Milestone M5b · Accounts

| Field | Value |
|---|---|
| Milestone | M5b (roadmap, added 2026-10-10) |
| Exit criterion | sign-in, saving (signed in and signed out), watching, chip editing, account settings, export/delete and the owner views work end to end |
| Specs | 011 (accounts, saved items, watchlist, alerts), 003 FR-FEAT-011 (chip editing), 014 FR-ABU-002 (signed-in limits), 015 §5.6 (`/ops`), 013 (terms, 18+, export, delete, policy line) |
| Started | 2026-10-10 |
| Branch | `m5b-accounts`, on top of `m5-freshness` (rebase onto `main` once M5 is merged) |

Status: ☐ open · ◐ in progress · ☑ done · ⏸ waiting for the owner

**2026-10-10: built and tested (mock sign-in); real sign-in waits for owner steps H1–H4.** Tests: web 55 unit/integration, 74 end-to-end (desktop + mobile, axe incl. /sign-in and /account), jobs 58, core 140, email 6.

## Decisions for this milestone (2026-10-10)
1. **No sign-in library in the browser.** Sign-in, the callback, anonymous sessions and sign-out all run on the
   server (`@supabase/ssr` sets httpOnly cookies); the browser only calls our own `/api/me/*` routes. Pages stay
   static; the account page loads its data from the API.
2. **One way to move signed-out saves into an account.** Before signing in, the server remembers the anonymous user
   in a short-lived signed cookie; after the sign-in callback it moves the saved items (skipping duplicates and
   anything over the limits) and deletes the anonymous user. This replaces both paths of spec 011 §5.7 (identity
   linking needs an extra Supabase setting and still needs the move for existing accounts).
3. **Mock sign-in for tests and local development.** With `MOCK_EXTERNALS=1` the sign-in buttons go to a mock
   provider and saved items live in memory, so every flow is tested end to end without accounts or keys. The live
   site gets real sign-in when it leaves mock mode (owner steps H1–H4).
4. **E-mail stays off** (owner decision 2026-10-03). Alerts are in-app; the digest builder, unsubscribe tokens and
   `/api/unsubscribe` exist so switching `EMAIL_MODE=on` later needs no new code paths, but nothing sends e-mail now.
5. **Saved searches stay viewable.** Saving extends the stored search's expiry (no personal data in it) so the saved
   link keeps working; the description is stored only for signed-in users who choose to save it (FR-ACC-004, P5).

## A. Sign-in (spec 011 §5.1, §5.5)
| # | Task | Requirement | Status |
|---|---|---|---|
| A1 | Server session layer: current user (signed in / anonymous), Google and GitHub sign-in URLs, code exchange, anonymous session (Turnstile-protected), sign out here / everywhere; mock provider | FR-ACC-002, 013 | ☑ |
| A2 | `/auth/sign-in`, `/auth/callback` (return to the page and replay the started action), `/auth/sign-out`; same-origin check on every state-changing request | FR-ACC-003, spec 011 §9 | ☑ |
| A3 | First sign-in: terms + 18+ page; profile row with policy version and time | FR-ACC-015, FR-PRIV-008 | ☑ |
| A4 | Signed-out saves move into the account after sign-in | FR-ACC-018 | ☑ |

## B. Saved items and settings (spec 011 §4, §5.4, §5.6)
| # | Task | Requirement | Status |
|---|---|---|---|
| B1 | Account store (Supabase with the user's session under RLS; memory in mock mode) | FR-DATA-004 | ☑ |
| B2 | `/api/me` (profile, settings, delete), `/api/me/saved-searches`, `/api/me/watchlist`, `/api/me/notifications`, `/api/me/export`, `/api/me/anonymous` | FR-ACC-004, 005, 010, 011, 012, 017, 019 | ☑ |
| B3 | Limits: 20 saved searches, 100 names → 409 with a clear message | FR-ACC-004, 005 | ☑ |
| B4 | Signed-in search limits (60/day, keyed by account) for search, find-more and refine | FR-ABU-002 | ☑ |

## C. Pages
| # | Task | Requirement | Status |
|---|---|---|---|
| C1 | Header: "Sign in" / "Account"; `/sign-in` with Google and GitHub | FR-ACC-001, 002 | ☑ |
| C2 | Results: "Save search" and a star on each card (signed out too) | FR-ACC-004, 005, 017 | ☑ |
| C3 | `/account`: saved searches (open, run again, delete), watchlist, notifications (30 days), settings, export, delete, sign out (here / everywhere); signed-out savers see their items and "Delete my saved items" | FR-ACC-004…013, 019 | ☑ |
| C4 | Chip editing for signed-in users, read-only chips with "Sign in to edit" otherwise; `POST /api/search/{ref}/refine` re-ranks with the edited features without repeating detection | FR-FEAT-011 | ☑ |
| C5 | Privacy Policy line: saved items are stored on our servers and can be seen by the site operator; deleted accounts leave backups within 28 days | FR-ACC-021, FR-ACC-012 | ☑ |

## D. Alerts (spec 011 §5.2–5.3)
| # | Task | Requirement | Status |
|---|---|---|---|
| D1 | `watchlist` job (daily 04:00 UTC): re-check watched names and the top 10 results of saved searches with alerts on → in-app notifications (registered, available, price change ≥ 10 %) | FR-ACC-006, 007, FR-REF-008 | ☑ |
| D2 | Digest builder (one per user per day or week, registered/available first), HMAC unsubscribe tokens, `/api/unsubscribe` (page + one-click POST); sending only when `EMAIL_MODE=on` | FR-ACC-008, 009, 014, 016 | ☑ |

## E. Owner views (spec 011 §5.8, spec 015 §5.6)
| # | Task | Requirement | Status |
|---|---|---|---|
| E1 | `/ops`: job runs, meters, reports (owner only; everyone else gets "not found") | FR-OBS-005 | ☑ |
| E2 | `/ops/saved`: accounts, saved searches, saved names, watchlists (signed in and signed out) | FR-ACC-020 | ☑ |

## F. Tests
| # | Task | Status |
|---|---|---|
| F1 | Unit/integration: session layer, account routes (memory store), refine, feature edits, watchlist job (in-process database), digest and unsubscribe | ☑ |
| F2 | End to end (mock sign-in): sign in → terms → save → star → account page → settings → export → delete; signed-out save → sign in → items moved; chip editing; admin view allowed / not found | ☑ |

## H. Owner steps (before real sign-in on the live site)
| # | Task | Status |
|---|---|---|
| H1 | Supabase → Authentication → Providers: Google and GitHub on (OAuth apps from Google Cloud and GitHub, `docs/setup.md` Part B step 5); anonymous sign-ins on; CAPTCHA → Turnstile on | ☐ |
| H2 | Supabase → URL configuration: Site URL `https://domain-trail.vercel.app`, redirect URL `https://domain-trail.vercel.app/auth/callback` | ☐ |
| H3 | Vercel env: `OWNER_USER_ID` (your user id after the first sign-in: Supabase → Authentication → Users) | ☐ |
| H4 | Live mode needs Turnstile + Upstash (M4 I2) and `MOCK_EXTERNALS=0`; without a Jev key searches stay on the backup rules | ☐ |
