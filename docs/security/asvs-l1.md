# OWASP ASVS level 1 — checklist (spec 013 NFR-PRIV-003)

Each line maps an ASVS 4 level-1 area to how this project meets it and where it is tested. Review before launch and
after big changes. "Owner" marks items that are settings, not code.

| Area | Control | Test / evidence |
|---|---|---|
| V1 Architecture | Specs and tech files per feature; secrets only in Vercel and GitHub environments | `docs/`, `specs/`, gitleaks in CI |
| V2 Authentication | No passwords: Google/GitHub OAuth through Supabase Auth (PKCE); 2FA on all operator accounts (Owner) | `session.test.ts`, `account.spec.ts`, launch checklist §1 |
| V3 Session management | httpOnly, SameSite=Lax, Secure cookies set by the server; sign out here and everywhere; anonymous sessions only on first save | `session.test.ts`, `cookies.spec.ts` |
| V4 Access control | Row-level security on every table; owner pages answer 404 to non-admins; signed-out savers can never store a description | `rls-matrix.int.test.ts`, `schema-guard.test.ts`, `admin-view.spec.ts`, `me.int.test.ts` |
| V5 Validation and encoding | zod on every route with size limits; JSON only; React escaping, no raw HTML; catalog-only chip edits | route tests, `feature-edits.test.ts`, lint |
| V6 Cryptography | HMAC-SHA256 for result links, visitor codes, unsubscribe and session tokens; timing-safe compares; `age` for backups | `search-link.test.ts`, `unsubscribe.test.ts`, `backup.test.ts` |
| V7 Errors and logging | PII-scrubbing logger; error reports without bodies, headers or e-mail/IP; jobs log counts only | `log-redaction.test.ts`, `errors.test.ts`, `run-job.test.ts` |
| V8 Data protection | No description storage; retention jobs; export and delete | `retention.int.test.ts`, `me.int.test.ts` |
| V9 Communications | HTTPS only, HSTS preload, `upgrade-insecure-requests` | `headers.spec.ts` |
| V10 Malicious code | Dependabot, `pnpm audit`, CodeQL, gitleaks; release-age policy for new packages | `security.yml` |
| V11 Business logic | Per-visitor and per-account limits; human check on search, save and contact; daily caps on registry look-ups | `ratelimit.test.ts`, `rate-limit.test.ts` |
| V12 Files | No uploads | — |
| V13 API | Same-origin check on every state-changing route; no CORS | `session.test.ts` (`sameOrigin`), `me.int.test.ts` |
| V14 Configuration | Security headers and CSP; no `X-Powered-By`; env schema refuses invalid values | `headers.spec.ts`, `env.test.ts` |
