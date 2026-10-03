# Spec 015 — Observability and Cost Guard

| Field | Value |
|---|---|
| Spec ID | 015 |
| Area code | `OBS` |
| Status | Approved (2026-10-03) |
| Depends on | 002, 005, 010, 012, 014 |
| Tech file | [tech.md](./tech.md) |
| Last updated | 2026-10-03 |

## 1. Why (problem and value)
The product runs on many free tiers at once. Each has limits, and exceeding any of them either breaks the
site or starts costing money — both unacceptable (constitution P1). The owner also needs to know quickly when
something breaks, and whether the product is actually helping people. Observability answers three questions
every day: **Is it working? Is it free? Is it good?**

## 2. What (scope summary)
- Error tracking for the website and background jobs, with alerts on new problems.
- Timing of every search stage and daily summaries.
- Usage meters for every limited resource compared with its free limit, with alerts at 50%, 80% and 100% and
  automatic degraded mode at 100%.
- A public Status page and an owner-only operations view.
- External uptime monitoring.
- Product-quality metrics and a monthly usage-and-cost report.

## 3. User stories and acceptance criteria

### US-1 Know about outages quickly
As the owner, I want to be alerted within 10 minutes if the site or search is down.
- **Given** the search API fails for 2 consecutive checks **When** the monitor detects it **Then** I receive an alert.

### US-2 Never exceed free limits
As the owner, I want warnings before any free limit is reached.
- **Given** decision-model usage reaches 80% of the monthly budget **When** it happens **Then** I receive an alert with the projection for month end;
  at 100% the site switches to degraded mode automatically.

### US-3 Monthly overview
As the owner, I want a monthly summary.
- **Given** the 1st of the month **When** the report runs **Then** I get a summary: searches, quality metrics, usage of each free tier (% of limit), incidents, and the bill ($0 expected).

## 4. Functional requirements

| ID | Requirement | Priority |
|---|---|---|
| FR-OBS-001 | Errors from the website and jobs MUST be captured with context (no personal data), grouped, and alerted when new. | MUST |
| FR-OBS-002 | Each search MUST record per-stage timings, token usage, degraded flag and outcome; daily summaries (p50/p95) MUST be kept. | MUST |
| FR-OBS-003 | Usage of every limited resource MUST be measured against its free limit: decision-model tokens, registry lookups, DNS lookups, related-word lookups, rate-limit store commands, e-mails, database size, scheduler minutes, hosting usage. | MUST |
| FR-OBS-004 | Alerts MUST fire at 50% (info), 80% (warning) and 100% (critical) of each limit per period; at 100% the documented degraded behavior MUST activate automatically. | MUST |
| FR-OBS-005 | A public Status page MUST show dataset ages and service states; an owner-only view MUST show jobs, budgets and recent errors. | MUST |
| FR-OBS-006 | The home page and search API MUST be monitored externally at least every 5 minutes. | MUST |
| FR-OBS-007 | Product metrics MUST be tracked: searches, cache hits, degraded/refused/needs-detail shares, actions per search, thumbs-up rate, availability accuracy. | MUST |
| FR-OBS-008 | A monthly usage-and-cost report MUST be produced and sent to the owner. | MUST |
| FR-OBS-009 | Telemetry MUST NOT contain personal data (descriptions, e-mails, IPs). | MUST |
| FR-OBS-010 | Alerts MUST be de-duplicated (same alert at most once per 6 hours) to avoid noise. | MUST |
| FR-OBS-011 | Hosting and scheduler usage that cannot be measured automatically MUST be checked manually once a month using a checklist. | MUST |
| FR-OBS-012 | Owner alerts and reports MUST be delivered by e-mail to the owner. If sending them would ever cost money, they MUST move to a free chat-app channel instead. | MUST |

## 5. Non-functional requirements

| ID | Requirement | Target |
|---|---|---|
| NFR-OBS-001 | Outage detection time | < 10 min |
| NFR-OBS-002 | Alert noise | < 5 non-actionable alerts per week |
| NFR-OBS-003 | Telemetry overhead per search | < 20 ms |
| NFR-OBS-004 | Monthly bill | $0 |

## 6. Data used (conceptual)
Error events (scrubbed), per-search operational numbers, daily aggregates, usage counters, job runs, uptime checks.

## 7. Edge cases and failure behavior

| Situation | Expected behavior |
|---|---|
| Error tracker quota used up | Errors still logged in platform logs; alert owner; sampling increased. |
| Monitor itself fails | Monthly checklist includes verifying monitors. |
| Usage spike from a viral post | Alerts at 50/80%; degraded mode protects budget; owner can raise limits only by approving costs. |

## 8. Out of scope
Paid monitoring suites, on-call rotations, log warehouses.

## 9. Success metrics
- All outages detected by monitoring before any user report.
- $0 billed every month.

## 10. Owner decisions (2026-10-03)
The reviewer questions of the draft were answered by the owner; the answers are applied above.

| Question | Decision |
|---|---|
| 1. Alerts by e-mail only or also a chat channel? | E-mail only for now; switch to a free chat app if e-mail would cost money (FR-OBS-012). |
