# Tech 013 — Privacy, Security and Compliance

| Field | Value |
|---|---|
| Implements | [spec.md](./spec.md) |
| Status | Approved (2026-10-03) |
| Owning packages | `apps/web/next.config.ts` (headers), `apps/web/middleware.ts`, `apps/web/app/(marketing)/privacy`, `terms`, `packages/log`, `.github/workflows/security.yml` |
| Last updated | 2026-10-03 |

## 1. Components and diagram

```
Request → Vercel edge (TLS, HSTS) → middleware.ts (CSP nonce, security headers, origin check)
        → route handler (zod validation) → packages/log (PII-safe logger) → Sentry (beforeSend scrubber)
CI → security.yml: pnpm audit, OSV-Scanner, Semgrep OSS, gitleaks (secrets), CodeQL (if repo public)
Dependabot → weekly dependency PRs
```

## 2. Stack and libraries

| Concern | Choice | Notes |
|---|---|---|
| Headers / CSP | Next.js middleware with per-request nonce | `script-src 'self' 'nonce-…' challenges.cloudflare.com static.cloudflareinsights.com` |
| Logging | `pino` wrapper `packages/log` with redaction paths | redacts `description`, `email`, `ip`, `authorization`, `cookie` |
| Error tracking | Sentry `beforeSend` + `sendDefaultPii: false` | request bodies dropped |
| Secret scanning | `gitleaks` in CI + GitHub secret scanning (public repos) | |
| Vulnerabilities | Dependabot, `pnpm audit --prod`, OSV-Scanner | free |
| SAST | Semgrep OSS rules (`p/nextjs`, `p/typescript`), CodeQL when public | free |

## 3. Data model
`profiles.terms_version`, `profiles.terms_accepted_at`, `profiles.age_confirmed boolean not null` (FR-PRIV-008, 016).
Policy versions live in `apps/web/content/policies/{privacy,terms}-vN.mdx`; current version constant in `packages/config`.

## 4. Interfaces
- `/privacy`, `/terms` (MDX, versioned; previous versions under `/privacy/v1` etc.).
- Grievance officer (decided 2026-10-03): **Priyansh K — priyansh1210@gmail.com**, published on `/privacy` and the
  contact page from `GRIEVANCE_NAME` / `GRIEVANCE_EMAIL`. A contact form also stores messages in `contact_messages`
  (RLS: service only; retention 1 year) and notifies the owner.

## 5. Algorithms and logic

### 5.1 Security headers (FR-PRIV-011)
```
Strict-Transport-Security: max-age=63072000; includeSubDomains; preload
Content-Security-Policy: default-src 'self'; script-src 'self' 'nonce-{n}' https://challenges.cloudflare.com https://static.cloudflareinsights.com;
  frame-src https://challenges.cloudflare.com; connect-src 'self' https://*.supabase.co https://cloudflareinsights.com https://*.ingest.sentry.io;
  img-src 'self' data:; style-src 'self' 'unsafe-inline'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; object-src 'none'
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: camera=(), microphone=(), geolocation=(), interest-cohort=()
Cross-Origin-Opener-Policy: same-origin
```

### 5.2 PII-safe logging (FR-PRIV-004, 005)
- Logger redaction list + a unit test that logs a fixture containing a description/e-mail/IP and asserts none appear.
- Vercel request logs contain IPs by platform default (short retention on Hobby) — disclosed in the policy as the hosting
  provider's processing; our code never writes IPs.
- Rate limiting uses `visitor_hash` (spec 012 §5.6) and Upstash keys with TTL ≤ 24 h.

### 5.3 Input validation and output encoding (FR-PRIV-018)
- zod on every route; body size limits; JSON only.
- React escapes output; no `dangerouslySetInnerHTML` (ESLint rule `react/no-danger` = error).
- External data (RDAP, Datamuse, provider lists) validated with zod and length-limited before use.
- SQL only via parameterized queries (supabase-js / `postgres` tagged templates).

### 5.4 Origin check (CSRF) for state-changing routes
`POST/PATCH/DELETE` require `Origin` ∈ {site URL, preview URLs}; otherwise 403.

### 5.5 Access and secrets (FR-PRIV-012, 014)
- 2FA required on GitHub, Vercel, Supabase, Upstash, Cloudflare, Resend, Sentry, TypeSafe/Vercel AI Gateway accounts (checklist in spec 017 runbook).
- Secrets only in Vercel env (encrypted) and GitHub Actions secrets; `.env.local` git-ignored; `.env.example` lists names only.
- Rotation runbook: rotate → update Vercel/Actions → redeploy → revoke old; do immediately if leaked, otherwise yearly.

### 5.6 Incident response (FR-PRIV-015)
Runbook `docs/runbooks/incident.md` (created at implementation): 1) detect (Sentry/alerts/report) 2) contain (rotate keys,
disable feature flag, block route) 3) assess data affected 4) notify: affected users without undue delay; EU/UK authority
within 72 h where GDPR applies; Data Protection Board of India and affected users per DPDP rules 5) post-mortem within 7 days.

### 5.7 Privacy Policy outline (FR-PRIV-001, 009, 010, 017)
1. Summary (6 bullets: no account needed; we don't keep your description; no ads/tracking; what saving and accounts
   store; saved items can be seen by the site operator; your rights).
2. What we collect (anonymous search; saving without an account — random identifier + saved names/searches, no
   description; signed-in; technical data processed by hosting providers).
2a. Who can access your data: you; the site operator through a private admin view (saved items, accounts,
   watchlists); sub-processors only as needed to run the service (FR-PRIV-001, spec 011 FR-ACC-021).
3. Why (purposes) and legal basis / consent.
4. Decision model: descriptions are sent to TypeSafe (via Vercel AI Gateway) to classify and rank; their retention terms (R-01).
5. Retention table (from spec 012 §3).
6. Sub-processors: Vercel (hosting, AI gateway; functions in Mumbai), Supabase (database/auth, Mumbai, India), TypeSafe (decision model),
   Upstash (rate limits), Cloudflare (DNS lookups, human check, analytics), Resend/Brevo (e-mail, when enabled), Sentry (errors),
   GitHub (scheduled jobs, backups), Datamuse (single words only), registries (domain names only).
7. Your rights (access/export, correction, deletion, withdraw consent, grievance, nominate — DPDP) and how to use them.
8. Children (18+ accounts).
9. Security measures summary.
10. International transfers.
11. Changes and versions; contact/grievance officer.

### 5.8 Terms outline (FR-PRIV-002)
Service description; no guarantee of availability/prices; purchases happen at third-party registrars; no trademark
clearance — users must check trademarks; acceptable use (no automated scraping, no phishing/impersonation); account rules
(18+); limitation of liability; governing law (owner's jurisdiction, open question); changes.

## 6. External services and free-tier limits

| Service | Used for | Limit | Source | Verified |
|---|---|---|---|---|
| Dependabot, secret scanning | dependencies, leaks | free | docs.github.com | R-09 |
| CodeQL | SAST | free for public repositories only | docs.github.com/code-security | R-09 |
| Semgrep OSS, OSV-Scanner, gitleaks | SAST, vulns, secrets | free open source | project sites | — |
| Sentry Developer | errors | free tier event quota | sentry.io/pricing | R-09 |

## 7. Configuration and secrets
`POLICY_VERSION`, `SENTRY_DSN`, `SENTRY_AUTH_TOKEN` (CI only), allowed origins list, CSP hosts list.

## 8. Errors, retries and fallbacks

| Failure | Response |
|---|---|
| CSP violation reports | `report-to` Sentry endpoint (sampled) |
| Security scan finds critical issue | CI fails on PRs; scheduled scan opens an issue |

## 9. Security and privacy controls
This file is the control set. ASVS L1 checklist lives in `docs/security/asvs-l1.md` (created at implementation) with each item mapped to a control/test.

## 10. Performance and cost budgets
All tools free; middleware overhead < 5 ms.

## 11. Test plan

| Test | Type | What it proves |
|---|---|---|
| `headers.spec.ts` | e2e | all headers present with expected values |
| `log-redaction.test.ts` | unit | description/e-mail/IP never logged |
| `sentry-scrub.test.ts` | unit | beforeSend drops bodies and PII |
| `origin-check.test.ts` | unit | cross-origin POST → 403 |
| `cookies.spec.ts` | e2e | only necessary cookies set (anonymous: none except Turnstile's until the first Save, then the Supabase anonymous-session cookie; signed-in: auth) |
| `policy-content.test.ts` | unit | policy MDX contains required sections, grievance contact and the saved-items/operator-access line |
| `security.yml` | CI | audit, OSV, Semgrep, gitleaks pass |
| `schema-guard.test.ts` (spec 012) | integration | no stored anonymous descriptions |
| ASVS checklist review | manual before launch | NFR-PRIV-003 |

## 12. Observability
CSP reports, Sentry security-tagged errors, Dependabot alerts count, time-to-fix for critical vulns.

## 13. Traceability matrix

| Requirement | Component(s) | Test(s) |
|---|---|---|
| FR-PRIV-001 | privacy MDX §5.7 | `seo.spec.ts` (page exists), legal review |
| FR-PRIV-002 | terms MDX §5.8 | `seo.spec.ts`, legal review |
| FR-PRIV-003 | cookieless analytics, no other cookies | `cookies.spec.ts` |
| FR-PRIV-004 | `packages/log`, Sentry scrub | `log-redaction.test.ts`, `sentry-scrub.test.ts` |
| FR-PRIV-005 | visitor hash, no IP writes | `log-redaction.test.ts`, `schema-guard.test.ts` |
| FR-PRIV-006 | account export/edit/delete (spec 011) | `export-delete.int.test.ts` |
| FR-PRIV-007 | grievance officer (Priyansh K, priyansh1210@gmail.com) + contact form | `contact.spec.ts`, `policy-content.test.ts` |
| FR-PRIV-008 | age confirmation at sign-up | `account.spec.ts` |
| FR-PRIV-009 | sub-processor list in policy | legal review checklist |
| FR-PRIV-010 | `buildState` whitelist (spec 002) | `state-privacy.test.ts` |
| FR-PRIV-011 | middleware headers | `headers.spec.ts` |
| FR-PRIV-012 | env handling, gitleaks | `security.yml` |
| FR-PRIV-013 | Dependabot, audit, OSV, Semgrep | `security.yml` |
| FR-PRIV-014 | 2FA checklist (spec 017) | launch checklist |
| FR-PRIV-015 | incident runbook | tabletop exercise before launch |
| FR-PRIV-016 | `profiles.terms_version` | `account.spec.ts` |
| FR-PRIV-017 | Supabase `ap-south-1` + Vercel function region `bom1` (Mumbai), disclosed in policy | launch checklist, `policy-content.test.ts` |
| FR-PRIV-018 | zod, React escaping, param queries | lint rules, route tests |
| NFR-PRIV-001 | headers | `headers.spec.ts` + external scan |
| NFR-PRIV-002 | scanners | Dependabot/OSV reports |
| NFR-PRIV-003 | ASVS checklist | pre-launch review |
| NFR-PRIV-004 | policy summary | owner review |

## 14. Risks and research links
- R-01: TypeSafe / Vercel AI Gateway data retention and training policies must be confirmed before launch (affects policy text).
- Legal texts need review by a qualified person (not free; recommended before public launch).
