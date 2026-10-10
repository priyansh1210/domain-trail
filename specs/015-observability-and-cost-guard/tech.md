# Tech 015 — Observability and Cost Guard

| Field | Value |
|---|---|
| Implements | [spec.md](./spec.md) |
| Status | Approved (2026-10-03) |
| Owning packages | `packages/metrics`, `packages/jev/budget.ts`, `apps/web/app/status`, `apps/web/app/ops` (owner-only), `jobs/usage-report` |
| Last updated | 2026-10-03 |

## 1. Components and diagram

```
web (route handlers) ──errors──▶ Sentry (scrubbed)          UptimeRobot (5-min) ──▶ /api/health, /
      │ per-search record (searches.stage_ms, jev_tokens, degraded, status)
      │ counters: Upstash cap:* (rdap, doh, datamuse, email) · Postgres jev_usage
      ▼
jobs/cleanup (daily)  → search_metrics_daily aggregates, DB size, budget % → alerts (Resend to owner)
jobs/usage-report (monthly) → quality_reports + e-mail to owner
/status (public, ISR 5 min) · /ops (owner-only, Supabase Auth + OWNER_USER_ID check)
```

## 2. Stack and libraries

| Concern | Choice | Notes |
|---|---|---|
| Errors | Sentry (`@sentry/nextjs`, `@sentry/node` in jobs) | free developer plan; `tracesSampleRate: 0.05` |
| Uptime | UptimeRobot free (5-min interval, e-mail alerts) | or Better Stack free (R-09) |
| Web vitals | Cloudflare Web Analytics + `web-vitals` → Sentry | cookieless |
| Alerts | `packages/metrics/alert.ts` → Resend to `OWNER_ALERT_EMAIL` (owner address works without a sending domain) | dedupe key in Upstash, TTL 6 h |

## 3. Data model
- `searches.stage_ms jsonb` (e.g. `{"s0":120,"s1":1650,…}`), `jev_tokens`, `degraded`, `status`, `duration_ms` (spec 012; add `stage_ms`).
- `search_metrics_daily` (spec 012) extended with `p50_stage_ms jsonb`, `p95_stage_ms jsonb`, `degraded`, `refused`, `needs_detail`, `actions`, `thumbs_up`, `thumbs_down`.
- `jev_usage`, `email_log`, `job_runs`, `quality_reports` (spec 012).

## 4. Interfaces
- `GET /api/health` → `{ ok, db: 'ok'|'down', upstash: 'ok'|'down', jevBreaker: 'closed'|'open', version, mode: 'live'|'mock' }` (no secrets; cached 30 s). In mock mode (`MOCK_EXTERNALS=1`) db/upstash report the in-process mocks.
- `GET /api/status` (spec 009 OpenAPI).
- `alert(level: 'info'|'warning'|'critical', key: string, message: string, data?: object)`.

## 5. Algorithms and logic

### 5.1 Meters and limits (FR-OBS-003, 004)

| Resource | Meter | Period | Limit (config) | 100% behavior |
|---|---|---|---|---|
| Jev tokens (search) | `jev_usage.input_tokens` | month / day | 100M / 4M | degraded ranking (spec 002) |
| Jev tokens (eval) | `jev_usage.eval_tokens` | month | 10M | skip eval, alert |
| RDAP requests | Upstash `cap:rdap:{day}` | day | 60,000 | cache-only + notice (spec 005) |
| DoH queries | `cap:doh:{day}` | day | 150,000 | RDAP-only for top results |
| Datamuse calls | `cap:datamuse:{day}` | day | 50,000 (half of 100k) | offline word data |
| Upstash commands | Upstash usage API / estimate | month | 400k (of 500k) | switch to in-memory limiter |
| E-mails | `email_log` | day / month | 100 / 3,000 | defer digests (spec 011) |
| DB size | `pg_database_size` | now | 300 MB warn / 350 MB crit | retention auto-tuning (spec 012) |
| GitHub Actions minutes | billing API or manual | month | unmetered (public repository); 2,000 if ever private | informational; disable optional jobs only if the repo goes private |
| Vercel usage | manual dashboard check | month | Hobby limits | manual action |
| Sentry events | Sentry quota | month | plan quota | raise sampling |

Threshold checks run: inline (Jev budget, caps — spec 002/005) and daily in `jobs/cleanup` (all meters). Month-end
projection: `used / dayOfMonth × daysInMonth`; alert when projection > 100% even if current < 80%.

### 5.2 Alert rules (FR-OBS-001, 010)

| Key | Condition | Level |
|---|---|---|
| `uptime` | 2 failed checks (UptimeRobot) | critical |
| `error-new` | Sentry new issue | warning |
| `error-spike` | > 50 events/h in Sentry issue | critical |
| `jev-auth` | Jev 401 | critical |
| `budget-<res>-50/80/100` | §5.1 | info/warning/critical |
| `job-failed-twice` | spec 010 | warning |
| `data-stale` | any dataset age > 30 h | warning |
| `avl-unknown-rate` | unknown > 20% of checks in 1 h | warning |
| `accuracy-low` | monthly accuracy < 97% | warning |
Dedup: `SET alert:{key} NX EX 21600`.

### 5.3 Per-search telemetry (FR-OBS-002, 009)
`const t = timer()` around each stage → `stage_ms`; written once with the final `searches` update (no extra writes).
Telemetry objects are built from a whitelist (numbers, enums) — no free text.

### 5.4 Monthly report (FR-OBS-008)
Workflow `monthly-usage-report.yml` (1st, 07:00 UTC): compile meters (§5.1), product metrics (§5.5), job success rates,
accuracy report, Sentry issue counts (API), and a manual-checklist section (Vercel, GitHub minutes if not available by API)
→ `quality_reports(kind='monthly')` + e-mail to owner.

### 5.5 Product metrics (FR-OBS-007)
Daily from `searches`, `search_results`, `feedback`, `result_events`: searches, uncached, cache-hit %, degraded %, refused %,
needs-detail %, actions per search, thumbs-up rate, top-5 click share, avg available results per section.

### 5.6 Owner-only ops view (FR-OBS-005)
`/ops` requires a session whose `user.id = OWNER_USER_ID` (or in `ADMIN_USER_IDS`); `/ops/saved` is the saved-items admin view (spec 011 §5.8); `/ops` shows `job_runs`, meters with % bars, last 20 Sentry issues
(link-outs), reports list. Server-rendered; not indexed.

## 6. External services and free-tier limits

| Service | Used for | Limit | Source | Verified |
|---|---|---|---|---|
| Sentry Developer | errors, perf sampling | free quota (errors/month) | sentry.io/pricing | R-09 |
| UptimeRobot | uptime | 50 monitors, 5-min interval, free | uptimerobot.com/pricing | R-09 |
| Cloudflare Web Analytics | traffic, vitals | free | cloudflare.com/web-analytics | R-09 |

## 7. Configuration and secrets
`SENTRY_DSN`, `SENTRY_AUTH_TOKEN`, `OWNER_ALERT_EMAIL`, `OWNER_USER_ID`, meter limits in `packages/config`, `UPSTASH_*`, `RESEND_API_KEY`.

## 8. Errors, retries and fallbacks

| Failure | Response |
|---|---|
| Resend alert fails | GitHub Action failure e-mail (jobs) / Sentry alert e-mail (web) as secondary channel |
| Sentry quota exhausted | sample errors at 10%; alert |
| Meters unavailable (Upstash down) | caps enforced by in-memory estimates; alert |

## 9. Security and privacy controls
Sentry scrubbing (spec 013), `/ops` owner-only, `/api/health` exposes no secrets or internal hostnames.

## 10. Performance and cost budgets
Telemetry adds one JSON column write per search (already writing `searches`), Sentry sampling 5%: < 20 ms overhead.

## 11. Test plan

| Test | Type | What it proves |
|---|---|---|
| `meters.test.ts` | unit | thresholds, projection math, 100% behaviors triggered |
| `alert-dedupe.test.ts` | unit | once per 6 h per key |
| `telemetry-whitelist.test.ts` | unit | no free text in telemetry objects |
| `health.int.test.ts` | integration | health reflects dependency outages |
| `ops-auth.spec.ts` | e2e | non-owner gets 404 on /ops |
| `usage-report.test.ts` | unit | report compiles from fixtures |

## 12. Observability
(This spec.) Dashboards = `/status` (public) and `/ops` (owner).

## 13. Traceability matrix

| Requirement | Component(s) | Test(s) |
|---|---|---|
| FR-OBS-001 | Sentry web + jobs, alert rules | `alert-dedupe.test.ts`, Sentry test event |
| FR-OBS-002 | `stage_ms`, daily aggregates | `telemetry-whitelist.test.ts`, `cleanup.int.test.ts` |
| FR-OBS-003 | meters §5.1 | `meters.test.ts` |
| FR-OBS-004 | thresholds + 100% behaviors | `meters.test.ts`, `degraded-mode.int.test.ts` |
| FR-OBS-005 | `/status`, `/ops` | `status.spec.ts`, `ops-auth.spec.ts` |
| FR-OBS-006 | UptimeRobot monitors on `/` and `/api/health` | monthly checklist |
| FR-OBS-007 | §5.5 | `cleanup.int.test.ts` |
| FR-OBS-008 | `jobs/usage-report` | `usage-report.test.ts` |
| FR-OBS-009 | whitelist telemetry, Sentry scrub | `telemetry-whitelist.test.ts`, `sentry-scrub.test.ts` |
| FR-OBS-010 | dedupe | `alert-dedupe.test.ts` |
| FR-OBS-011 | manual checklist in report | `usage-report.test.ts` |
| FR-OBS-012 | `alert.ts` e-mail channel (Resend → `OWNER_ALERT_EMAIL`, sent to the owner's own address so no domain is needed); `ALERT_CHANNEL` switch to a free chat-app webhook if e-mail would cost money | `alert-dedupe.test.ts`, `alert-channel.test.ts` |
| NFR-OBS-001 | 5-min monitor, 2 failures | uptime reports |
| NFR-OBS-002 | dedupe + thresholds | monthly alert count |
| NFR-OBS-003 | single write | `pipeline.perf.test.ts` |
| NFR-OBS-004 | meters + caps | monthly report |

## 14. Risks and research links
- R-09: current limits of Sentry, UptimeRobot, Upstash, Vercel Hobby, GitHub Actions.

## 15. Implementation notes (M5, 2026-10-10)
- `packages/metrics`: `sendAlert` (Resend e-mail to the owner's own address, or a chat webhook with
  `ALERT_CHANNEL=chat` + `ALERT_WEBHOOK_URL`) and `meterAlerts` (50/80/100 % and month-end projection).
- Info-level alerts (50 %) are only logged; warnings and critical alerts are delivered, and so is the monthly report.
- Jobs de-duplicate alerts in the `alert_log` table (once per key per 6 h); the web will use Upstash or memory.
- Meters checked daily by `cleanup`: database size, Jev tokens, evaluation tokens, e-mails per day and month.
  RDAP/DoH/Datamuse caps are still enforced in each server instance (no shared counters yet).
- Sentry, UptimeRobot and Cloudflare Web Analytics need owner accounts: milestone M6.
