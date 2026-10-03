# Tech 017 — Infrastructure and Deployment

| Field | Value |
|---|---|
| Implements | [spec.md](./spec.md) |
| Status | Approved (2026-10-03) |
| Owning packages | repository root, `.github/workflows`, `apps/web/vercel.json` (if needed), `supabase/`, `docs/runbooks/` (created at implementation) |
| Last updated | 2026-10-03 |

## 1. Components and diagram

```
GitHub repo ──PR──▶ ci.yml / security.yml ──(required checks)──▶ merge to main
     │                    │
     │                    └─▶ Vercel preview (automatic via Git integration) ──▶ lighthouse.yml
     └─ main ──▶ Vercel production deploy (automatic)
             └─▶ migrate.yml (environment "production", manual approval) ──▶ supabase db push
Scheduled workflows (spec 010) ──▶ Supabase / Resend / external sources
```

## 2. Services, plans and regions (FR-INF-001, 010)

| Service | Plan | Purpose | Region (decided 2026-10-03) | Key limits (verify quarterly, R-09) |
|---|---|---|---|---|
| GitHub | Free, **public repository** | code, CI, scheduled jobs, backups (encrypted artifacts) | — | Actions unlimited for public repos; free CodeQL + secret scanning; logs and artifacts are publicly visible → never log secrets/PII, backups `age`-encrypted |
| Vercel | Hobby | web + API + AI Gateway | functions `bom1` (Mumbai) | non-commercial use; function duration and invocation limits; $5 AI Gateway credit / 30 days |
| Supabase | Free | Postgres, Auth | `ap-south-1` (Mumbai) | 500 MB DB; pauses after 7 days inactivity; 2 projects |
| Upstash Redis | Free | rate limits | `ap-south-1` if available, else nearest | 500k commands/month |
| Cloudflare | Free | Turnstile, Web Analytics, DoH | global | — |
| TypeSafe Jev | via Vercel AI Gateway | decisions | — | $0.042 / 1M input tokens from credit |
| Resend | Free | owner alerts (and user e-mail when `EMAIL_MODE=on`) | — | 3,000/month, 100/day; own domain needed for user e-mail |
| Sentry | Developer (free) | errors | — | event quota |
| UptimeRobot | Free | uptime | — | 50 monitors, 5-min |
| Porkbun | free account | pricing (no auth), accuracy checks (API key) | — | checkDomain 1/10 s |

Alternatives if a free plan disappears: Netlify (also offers Jev in its AI Gateway) or Cloudflare Pages for hosting;
Neon for Postgres + Auth.js for auth; Brevo for e-mail; Better Stack for uptime.

## 3. Data model
N/A (infrastructure). Backups: spec 012 §5.4.

## 4. Interfaces — environment variables (master list, FR-INF-005)

| Variable | Scope | Used by | Spec |
|---|---|---|---|
| `NEXT_PUBLIC_SITE_URL` | public | links, CSP, origin check (launch: `https://<project>.vercel.app`) | 000, 009, 013 |
| `NEXT_PUBLIC_SITE_NAME` | public | product name everywhere in the UI and metadata | 000 |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | public | auth client | 011 |
| `SUPABASE_SERVICE_ROLE_KEY` | server, Actions | jobs, account deletion | 011, 012 |
| `SUPABASE_DB_URL` | Actions | jobs, migrations, backups | 010, 012 |
| `AI_GATEWAY_API_KEY` | server, Actions | Jev | 002 |
| `TYPESAFE_API_KEY` | server (optional) | Jev direct route | 002 |
| `JEV_ROUTE`, `JEV_MODEL`, `JEV_*` caps | server, Actions | Jev | 002 |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | server | limits, caps | 014 |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` | public / server | human check | 001, 014 |
| `SEARCH_LINK_SECRET`, `VISITOR_SALT_SECRET`, `UNSUBSCRIBE_SECRET` | server, Actions | HMACs | 001, 012, 011 |
| `RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET`, `EMAIL_MODE`, `EMAIL_FROM` | server, Actions | e-mail | 011, 015 |
| `BREVO_API_KEY` | Actions (optional) | e-mail overflow | 011 |
| `OWNER_ALERT_EMAIL`, `OWNER_USER_ID` | server, Actions | alerts, /ops | 015 |
| `ADMIN_USER_IDS` | server | `/ops/saved` admin view | 011 |
| `GRIEVANCE_NAME`, `GRIEVANCE_EMAIL` | public | privacy page, contact page | 013 |
| `PORKBUN_API_KEY`, `PORKBUN_SECRET_KEY` | Actions | accuracy, premium background | 005, 006 |
| `NRD_URL_TEMPLATE` | Actions (variable) | NRD ingest | 010 |
| `SENTRY_DSN`, `SENTRY_AUTH_TOKEN` | server / CI | errors, source maps | 013, 015 |
| `NEXT_PUBLIC_CF_ANALYTICS_TOKEN` | public | analytics | 009 |
| `POLICY_VERSION` | server | terms acceptance | 013 |
| `MOCK_EXTERNALS` | local, CI | fixtures instead of live services | 016 |
| `RATE_LIMIT_MODE` | local, CI | `off` disables limits only when `MOCK_EXTERNALS=1` (end-to-end tests) | 014, 016 |
| `BACKUP_AGE_PUBLIC_KEY` | repo (public key) | backup encryption | 012 |

`.env.example` in the repo lists every name with a comment, never values. Config values that are not secrets
(thresholds, weights, TTLs) live in `packages/config/defaults.ts` and can be overridden by env vars.

## 5. Algorithms and logic

### 5.1 Account setup order (FR-INF-011, 013) — step-by-step guide `docs/setup.md` (created at implementation)
1. GitHub account (2FA) → create repository → branch protection on `main` (required checks: ci, security; linear history).
2. Vercel (sign in with GitHub, 2FA) → import repo → root `apps/web` → Node 22 → function region `bom1`.
3. Vercel AI Gateway → create API key → verify `typesafe-ai/jev` is available → store `AI_GATEWAY_API_KEY`.
4. Supabase (2FA) → project in `ap-south-1` → copy URL/anon/service keys + pooler DB URL → enable Google & GitHub providers.
5. Google Cloud console → OAuth client (free) · GitHub → OAuth app → paste into Supabase.
6. Upstash (2FA) → Redis database (free) → REST URL/token.
7. Cloudflare (2FA) → Turnstile site (managed/invisible) → keys; Web Analytics site → token.
8. Sentry (2FA) → Next.js project → DSN.
9. Resend (2FA) → API key (owner alerts); `EMAIL_MODE=off` until a sending domain exists.
10. Porkbun account (2FA) → API access → keys (Actions only).
11. UptimeRobot → monitors for `/` and `/api/health`.
12. Put secrets into Vercel (Production/Preview separately) and GitHub Actions secrets; create GitHub environment
    `production` with required reviewer = owner.
13. Run `migrate.yml` (approve) → run `seed` job → trigger all daily jobs once manually → verify `/status`.

### 5.2 Deploy and migrations (FR-INF-002, 003, 004)
- Vercel Git integration: previews for PR branches, production for `main`.
- Migrations: `migrate.yml` on push to `main` when `supabase/migrations/**` changed → job targets environment
  `production` (manual approval) → `supabase db push --db-url $SUPABASE_DB_URL`.
- Migration rule: expand/contract (additive first, code switch, remove later) so app and DB versions can differ by one release.

### 5.3 Rollback (FR-INF-007)
Vercel dashboard → Deployments → previous production deployment → "Instant Rollback" (or `vercel rollback`).
DB: migrations are backward compatible; destructive changes are never in the same release as the code change.

### 5.4 Local development (FR-INF-006)
Prerequisites: Node 22, pnpm 9+, Docker Desktop (WSL2 on Windows), Supabase CLI.
```
pnpm install
cp .env.example .env.local        # MOCK_EXTERNALS=1 by default
pnpm supabase start && pnpm db:reset   # migrations + seed
pnpm dev                          # http://localhost:3000
```
`MOCK_EXTERNALS=1` serves Jev/DoH/RDAP/Datamuse/Porkbun from fixtures (MSW), so no keys are needed to start.

### 5.5 Runbooks (FR-INF-008) — `docs/runbooks/*.md` (created at implementation)
`deploy.md`, `rollback.md`, `rotate-secrets.md`, `restore-db.md` (decrypt artifact with `age` → `pg_restore` into a new/local
project → verify → switch), `reenable-workflows.md` (GitHub disables schedules after 60 days of repo inactivity on public
repos), `supabase-unpause.md`, `budget-exhausted.md` (confirm degraded mode, check abuse, wait for reset or owner-approved
spend), `incident.md` (spec 013).

### 5.6 Paid-upgrade path (FR-INF-009) — documented, not enabled

| Trigger | Upgrade | Approx. cost (verify at decision time) |
|---|---|---|
| Need reliable user e-mail (magic links, alerts) | Own domain for the site | ~$10–15 / year |
| > ~5,000 uncached searches/month | Pay Jev beyond the free credit | $0.042 per 1M tokens (≈ $0.001 per search) |
| Commercial use (e.g. affiliate links) or Hobby limits | Vercel Pro | ~$20 / month |
| DB > 500 MB, backups, no pausing | Supabase Pro | ~$25 / month |
| E-mail > 100/day | Resend paid plan | ~$20 / month |

## 6. External services and free-tier limits
See §2 (quarterly re-verification task; results recorded in `docs/research.md` R-09).

## 7. Configuration and secrets
§4. Secrets separated per environment (Preview uses a separate Supabase project or the local-only mock mode; Preview
never gets the production service-role key).

## 8. Errors, retries and fallbacks

| Failure | Response |
|---|---|
| Vercel build fails | PR blocked; production unaffected |
| Migration fails | job fails, no partial apply (transactional); app continues on previous schema |
| Provider outage | status page + degraded modes defined in each spec |

## 9. Security and privacy controls
2FA everywhere; least-privilege tokens; Actions pinned by SHA; `permissions:` minimal per workflow; Preview environment
without production secrets; recovery codes stored offline by the owner.

## 10. Performance and cost budgets
Build < 3 min (Turborepo cache), deploy < 5 min, $0/month.

## 11. Test plan

| Test | Type | What it proves |
|---|---|---|
| `env-schema.test.ts` | unit | app refuses to start with missing/invalid env (zod) and lists missing names |
| actionlint | CI | workflows valid |
| preview smoke | CI on deployment_status | preview `/api/health` ok |
| rollback drill | manual quarterly | FR-INF-007 |
| fresh-machine setup | manual before launch (Windows) | NFR-INF-002 |

## 12. Observability
Deployment notifications in GitHub; `/api/health` includes `version` (git SHA).

## 13. Traceability matrix

| Requirement | Component(s) | Test(s) / check |
|---|---|---|
| FR-INF-001 | §2 table + quarterly review | R-09 record |
| FR-INF-002 | Vercel Git integration | preview smoke |
| FR-INF-003 | branch protection + Vercel prod branch | repository settings check |
| FR-INF-004 | `migrate.yml` + environment approval | actionlint + first deploy |
| FR-INF-005 | `.env.example`, env zod schema | `env-schema.test.ts` |
| FR-INF-006 | §5.4, `MOCK_EXTERNALS` | fresh-machine setup |
| FR-INF-007 | §5.3 | rollback drill |
| FR-INF-008 | runbooks §5.5 | launch checklist |
| FR-INF-009 | §5.6 | owner review |
| FR-INF-010 | regions §2 | launch checklist |
| FR-INF-011 | §5.1, 2FA | launch checklist |
| FR-INF-012 | `*.vercel.app` address at launch; switching = env change (FR-SYS-011) | launch checklist, `site-config.test.ts` |
| FR-INF-013 | `docs/setup.md` | fresh-machine setup |
| FR-INF-014 | public repository; gitleaks in CI + GitHub secret scanning with push protection | `security` CI job, repository settings check |
| NFR-INF-001 | Turborepo cache | deploy timings |
| NFR-INF-002 | §5.4 | fresh-machine setup |
| NFR-INF-003 | free plans only | monthly report (spec 015) |

## 14. Risks and research links
- R-09: all free-plan limits; R-10: affiliate links vs Hobby terms (currently not used).
- Risk: Vercel Hobby is non-commercial — adding ads/affiliate links requires Pro (owner decision).
