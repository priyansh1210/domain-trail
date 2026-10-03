# Spec 010 — Daily Domain Data Refresh

| Field | Value |
|---|---|
| Spec ID | 010 |
| Area code | `REF` |
| Status | Approved (2026-10-03) |
| Depends on | 005, 006, 007, 011, 012 |
| Tech file | [tech.md](./tech.md) |
| Last updated | 2026-10-03 |

## 1. Why (problem and value)
The owner pointed out that new websites launch every day, so domain data goes stale quickly. Names we
said were available get registered, prices change, registries launch or retire extensions, free providers
open and close, and popular brands change. Without a reliable daily refresh the product would slowly start
lying to users. A daily refresh also lets us **learn** from what people are registering (naming trends) and
**alert** signed-in users when something they care about changes.

## 2. What (scope summary)
A set of scheduled background jobs that run every day (some weekly or monthly):

| Job | Frequency | What it keeps fresh |
|---|---|---|
| Extension registry | daily | list of all extensions, which registry service answers for each, extensions that answer "exists" for everything |
| Prices and currencies | daily | registration/renewal/transfer prices, currency rates |
| Newly registered names | daily | marks names we showed as available but that were registered yesterday as taken; alerts watchers; records naming trends |
| Free providers | daily | provider health and lists of taken free names |
| Popular brands | weekly | list of popular site names used to block brand imitations |
| Watchlists and saved searches | daily | re-checks watched names and top results of saved searches, sends alert digests |
| Clean-up | daily | deletes expired data according to retention rules |
| Quality checks | weekly / monthly | decision-model evaluation, availability accuracy, ranking weight proposals |

All jobs record what they did; the public Status page shows how old each type of data is.

## 3. User stories and acceptance criteria

### US-1 No stale "available"
As a visitor, I don't want to see names that were registered yesterday.
- **Given** `sunnycrust.shop` was cached as available **When** it appears in yesterday's newly-registered list **Then** by 03:00 UTC
  it is marked taken and no longer shown as available.

### US-2 Current prices
As a visitor, I want today's prices.
- **Given** a registrar changed a price yesterday **When** I search today after 01:30 UTC **Then** I see the new price.

### US-3 Visible freshness
As a visitor, I want to know when data was updated.
- **Given** the Status page **When** I open it **Then** I see the age of each dataset; anything older than 30 hours is highlighted.

### US-4 Owner is told about failures
As the owner, I want to know when a job fails.
- **Given** a job fails twice in a row **When** it happens **Then** I receive a notification with the job name and error summary.

### US-5 Alerts for watchers
As a signed-in user watching a name, I want to know if it gets registered.
- **Given** a watched name appears in the newly-registered list **When** the daily alert job runs **Then** my next in-app digest tells me
  (and an e-mail, once e-mail is enabled — spec 011).

## 4. Functional requirements

| ID | Requirement | Priority |
|---|---|---|
| FR-REF-001 | The extension list and the directory of authoritative registry services MUST be refreshed daily. | MUST |
| FR-REF-002 | Extension prices and currency rates MUST be refreshed daily, with sanity checks; failed checks MUST keep the previous data. | MUST |
| FR-REF-003 | The daily list of newly registered names MUST be processed to mark matching cached "available" names as taken and to flag matching watched names. | MUST |
| FR-REF-004 | Naming trends (frequent words, prefixes, suffixes, extensions) MUST be derived from newly registered names and stored only as aggregates. | MUST |
| FR-REF-005 | The full list of newly registered names MUST NOT be stored beyond processing. | MUST |
| FR-REF-006 | Free-provider health and taken-name lists MUST be refreshed daily. | MUST |
| FR-REF-007 | The popular-site list used for brand protection MUST be refreshed weekly. | MUST |
| FR-REF-008 | Watched names and the top results of saved searches MUST be re-checked daily, and changes MUST produce alerts (spec 011). | MUST |
| FR-REF-009 | Extensions whose name servers answer for every possible name MUST be detected at least weekly. | MUST |
| FR-REF-010 | A daily clean-up MUST delete data past its retention period (spec 012). | MUST |
| FR-REF-011 | Every job MUST be safe to run again (no duplicates or corruption) and MUST record start, end, result and statistics. | MUST |
| FR-REF-012 | Jobs of the same kind MUST NOT run at the same time. | MUST |
| FR-REF-013 | Each job MUST be startable manually by the owner. | MUST |
| FR-REF-014 | Two consecutive failures of any job MUST notify the owner by e-mail. | MUST |
| FR-REF-015 | The Status page MUST show the age of each dataset and highlight data older than 30 hours. | MUST |
| FR-REF-016 | Jobs MUST stay within free-tier limits and respect each data source's terms and rate limits. | MUST |
| FR-REF-017 | Quality jobs (weekly decision-model evaluation, monthly availability accuracy, monthly ranking-weight proposal) MUST run on schedule and publish their reports. | MUST |

## 5. Non-functional requirements

| ID | Requirement | Target |
|---|---|---|
| NFR-REF-001 | Each daily job duration | < 30 min |
| NFR-REF-002 | Monthly job success rate | ≥ 98% |
| NFR-REF-003 | Dataset age (normal operation) | < 26 h |
| NFR-REF-004 | Scheduler cost | $0 (within free minutes) |

## 6. Data used (conceptual)
Public reference files (extension list, registry directory, popular-site list), registrar price lists, currency rates,
the daily newly-registered list (processed, not kept), free-provider data, cached check results, watchlists, saved searches.

## 7. Edge cases and failure behavior

| Situation | Expected behavior |
|---|---|
| A source is unreachable | Retry within the job; if still failing, keep yesterday's data, record failure, alert after 2 failures. |
| Source format changes | Validation fails the job without overwriting data; alert. |
| A day's newly-registered file is missing | Next run processes any missing days (up to 7 days back) if available. |
| Job overlaps with next day's run | Second run waits or is skipped; never runs in parallel. |
| Huge alert volume (e.g. popular name lists) | Digests group changes; max 1 digest per user per day. |

## 8. Out of scope
- Real-time (minute-level) feeds of new registrations.
- Downloading full zone files from registries (possible phase 3 enhancement).

## 9. Success metrics
- NFR targets met for 3 consecutive months.
- Share of "available" results later found taken (accuracy sample) ≤ 3%.

## 10. Owner decisions (2026-10-03)
The reviewer questions of the draft were answered by the owner; the answers are applied above.

| Question | Decision |
|---|---|
| 1. Can the code repository be public? | Yes — public (unlimited free scheduler minutes). |
| 2. Alert channel for job failures | E-mail only for now (FR-REF-014); a chat app may come later. |
