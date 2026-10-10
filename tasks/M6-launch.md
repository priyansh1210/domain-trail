# Tasks — Milestone M6 · Launch

| Field | Value |
|---|---|
| Milestone | M6 (roadmap) |
| Exit criterion | public launch: launch checklist complete, every owner step done, $0 bill |
| Specs | 013 (privacy, security, policies, contact), 015 (errors, uptime, analytics), 017 (runbooks, launch checklist), 016 (quality gates) |
| Started | 2026-10-10 |
| Branch | `m6-launch`, on top of `m5b-accounts` (rebase after the earlier branches are merged) |

Status: ☐ open · ◐ in progress · ☑ done · ⏸ waiting for the owner

**2026-10-10: code and documents done; the rest is the owner's launch work (H1–H5, `docs/launch-checklist.md`).** Tests: web 63 unit/integration, 84 end-to-end (two full runs green; the test server is now warmed once before the tests, which removed a cold-start flake).

## Decisions for this milestone (2026-10-10)
1. **Pages stay static, so the script policy allows inline scripts.** A per-request nonce (spec 013 §5.1) would turn
   every page into a server call (cost and speed on the free plan). The policy still limits where scripts, frames and
   connections may come from, forbids plugins, framing and foreign form targets, and React escapes all output. A nonce
   can be added later without other changes.
2. **Error reporting without the Sentry SDK.** Server errors go to Sentry's ingestion endpoint with a small sender that
   removes request bodies, cookies, headers and anything that looks like an e-mail or IP before sending. Nothing is
   sent until `SENTRY_DSN` is set (owner step). This keeps the browser bundle unchanged.
3. **Policies are versioned text in the code** (`apps/web/content/policies.ts`, version `v1` = `POLICY_VERSION`); a test
   checks every section the spec requires. A qualified person should still review them before launch (paid, owner's
   choice — spec 013 §14).

## A. Policies and contact (spec 013)
| # | Task | Requirement | Status |
|---|---|---|---|
| A1 | Full Privacy Policy: summary, data collected, who can access (incl. the operator's admin view), purposes and legal basis, decision model, retention table, sub-processors and locations, rights, children, security, transfers, changes, grievance contact | FR-PRIV-001, 007, 009, 017, FR-ACC-021 | ☑ |
| A2 | Full Terms: service, no guarantees, purchases at registrars, trademarks, acceptable use, accounts 18+, liability, law, changes | FR-PRIV-002 | ☑ |
| A3 | Contact page + `POST /api/contact` (stored in `contact_messages`, kept 1 year; owner alerted; rate-limited; human check) | FR-PRIV-007 | ☑ |

## B. Security
| # | Task | Requirement | Status |
|---|---|---|---|
| B1 | Full Content-Security-Policy with host allowlists (Turnstile, Cloudflare analytics, Supabase, Sentry) and the other headers | FR-PRIV-011 | ☑ |
| B2 | End-to-end checks: headers present; only necessary cookies (none for an anonymous visitor until they save or sign in) | NFR-PRIV-001, FR-PRIV-003 | ☑ |
| B3 | ASVS level 1 checklist mapped to controls and tests (`docs/security/asvs-l1.md`) | NFR-PRIV-003 | ☑ |

## C. Monitoring (spec 015)
| # | Task | Requirement | Status |
|---|---|---|---|
| C1 | Server error reporting to Sentry with scrubbing (`instrumentation.ts` → `onRequestError`) | FR-OBS-001, 009 | ☑ |
| C2 | Cloudflare Web Analytics (cookieless) when `NEXT_PUBLIC_CF_ANALYTICS_TOKEN` is set | FR-UX (analytics), FR-PRIV-003 | ☑ |

## D. Runbooks and checklist (spec 017 §5.5)
| # | Task | Requirement | Status |
|---|---|---|---|
| D1 | `deploy.md`, `rollback.md`, `rotate-secrets.md`, `incident.md` | FR-INF-007, 008, FR-PRIV-015 | ☑ |
| D2 | `docs/launch-checklist.md`: every owner step from M1–M6 in order, with how to check each | FR-INF-011, FR-PRIV-014 | ☑ |

## H. Owner steps
| # | Task | Status |
|---|---|---|
| H1 | Sentry (free) → Next.js project → DSN into Vercel as `SENTRY_DSN` | ☐ |
| H2 | UptimeRobot (free) → monitors for `/` and `/api/health` every 5 minutes | ☐ |
| H3 | Cloudflare Web Analytics → site token into Vercel as `NEXT_PUBLIC_CF_ANALYTICS_TOKEN` | ☐ |
| H4 | Read the Privacy Policy and Terms; decide whether to pay for a legal review | ☐ |
| H5 | Work through `docs/launch-checklist.md` | ☐ |
