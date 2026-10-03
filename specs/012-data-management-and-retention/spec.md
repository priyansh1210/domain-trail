# Spec 012 — Data Management and Retention

| Field | Value |
|---|---|
| Spec ID | 012 |
| Area code | `DATA` |
| Status | Approved (2026-10-03) |
| Depends on | 000, 013 |
| Used by | every feature that stores data |
| Tech file | [tech.md](./tech.md) |
| Last updated | 2026-10-03 |

## 1. Why (problem and value)
The owner asked to plan data management first, with a strong preference for free services. Free database
plans are small, so every piece of data must earn its place. Data about users must be minimal and
protected; data about domains must be fresh and compact. Clear rules for **what** we keep, **why**,
**who** can see it and **for how long** protect users, keep the product legal, and keep it within free limits.

## 2. What (scope summary)
This spec defines the data inventory (every kind of data the product keeps), its purpose, sensitivity,
owner feature, visibility, retention period and storage budget. It also defines backup, restore and
data-quality rules.

## 3. Data inventory

| Dataset | Purpose | Contains personal data? | Visible to | Retention |
|---|---|---|---|---|
| Extensions (TLD list, registry directory, rules) | availability and pricing | No | public | kept; retired extensions flagged |
| Extension prices + price changes | pricing, history | No | public | current kept; changes kept indefinitely |
| Currency rates | display conversion | No | public | 90 days |
| Domain check results | shared availability cache | No (domain names only) | server only | deleted 30 days after expiry of freshness |
| Free providers + taken free names | Free section | No | public (providers), server (taken) | kept / refreshed daily |
| Popular-site brand list | brand protection | No | server only | replaced weekly |
| Naming trends | generation hints | No (aggregates) | server only | 180 days |
| Related-words cache | fewer external calls | No | server only | 30 days |
| Search records (features, results, counters) | results pages, sharing, caching, quality | No for anonymous (no description stored); linked to account if signed in | anyone with the link (results only) | 7 days (anonymous); while linked from a saved search |
| Result cache index | instant repeat searches | No | server only | 24 hours |
| Feedback votes and action events | ranking quality | Pseudonymous (daily-rotating visitor fingerprint) | server only | 13 months, then aggregated |
| Accounts (e-mail, sign-in provider, settings, policy acceptance) | sign-in, alerts | **Yes** | the user; owner (admin view) | until account deletion |
| Saved searches (incl. description) | continuity | **Yes** | the user; owner (admin view) | until deleted by user or account deletion |
| Watchlist | alerts | **Yes** (linked to user) | the user; owner (admin view) | until removed or account deletion |
| Signed-out saved items (saved names and searches, no description; random browser identifier) | continuity without an account | Pseudonymous | the visitor; owner (admin view) | until deleted by the visitor, moved into an account, or 90 days after last use |
| Notifications | alerts | **Yes** | the user | 90 days |
| Contact / grievance messages | answering users, legal duty | **Yes** (e-mail, message) | owner | 1 year |
| E-mail send counters | stay within free limits | No | server only | 90 days |
| Decision-model usage counters | budget guard | No | server only | 2 years (aggregates) |
| Job runs, quality reports | operations | No | server; summary public on Status | 90 days (job runs); reports kept |
| Backups | disaster recovery | Yes (copy of the above) | owner only | 28 days rolling |

## 4. User stories and acceptance criteria

### US-1 Nothing kept that we don't need
As an anonymous visitor, I want my description not to be stored.
- **Given** I search without an account **When** I look at what the service stores **Then** no copy of my description exists on the server after the search completes.

### US-2 Expired data really disappears
As the owner, I want retention rules enforced automatically.
- **Given** a search record older than 7 days not linked to a saved search **When** the daily clean-up runs **Then** it and its results are deleted.

### US-3 Recover from mistakes
As the owner, I want to restore data after an accident.
- **Given** a bad migration deleted a table **When** I follow the restore procedure **Then** data from the last weekly backup is restored within 1 hour.

## 5. Functional requirements

| ID | Requirement | Priority |
|---|---|---|
| FR-DATA-001 | Every stored dataset MUST appear in the data inventory with purpose, personal-data classification, visibility and retention. New datasets require an inventory update. | MUST |
| FR-DATA-002 | Anonymous descriptions MUST NOT be stored on the server. | MUST |
| FR-DATA-003 | Retention periods MUST be enforced automatically at least daily. | MUST |
| FR-DATA-004 | User-owned data MUST only be readable and writable by its owner (and by server jobs acting for the product); the owner of the site MAY read it through the admin view (spec 011 FR-ACC-020). | MUST |
| FR-DATA-005 | Reference data (extensions, prices, free providers) MAY be publicly readable. | MAY |
| FR-DATA-006 | Money MUST be stored as whole cents with a currency code; times MUST be stored in UTC. | MUST |
| FR-DATA-007 | Schema changes MUST be versioned, reviewed and reproducible (applied the same way in every environment). | MUST |
| FR-DATA-008 | The database MUST be backed up at least weekly, backups kept for 28 days, and a restore tested at least quarterly. | MUST |
| FR-DATA-009 | Total stored data MUST stay under 70% of the free database size limit, with an alert at 60%. | MUST |
| FR-DATA-010 | Reference data loads MUST be validated before replacing existing data. | MUST |
| FR-DATA-011 | Pseudonymous identifiers (visitor fingerprints) MUST rotate at least daily and MUST NOT be reversible to an IP address. | MUST |
| FR-DATA-012 | Search results pages MUST contain no personal data, so that sharing a link never exposes personal information. | MUST |

## 6. Non-functional requirements

| ID | Requirement | Target |
|---|---|---|
| NFR-DATA-001 | Database size | < 350 MB (70% of 500 MB) |
| NFR-DATA-002 | Restore time from backup | < 1 h |
| NFR-DATA-003 | Maximum data loss on disaster | ≤ 7 days for reference/user data (reference data can be rebuilt from sources) |
| NFR-DATA-004 | Hot queries (cache lookups, result snapshot) | < 50 ms p95 |

## 7. Edge cases and failure behavior

| Situation | Expected behavior |
|---|---|
| Database near size limit | Shorten cache retention automatically (30 → 14 days), alert owner. |
| Free database paused for inactivity | Daily jobs prevent this; if it happens, the owner restores it from the dashboard (runbook). |
| Retention job fails | Next run catches up; alert after 2 failures. |

## 8. Out of scope
- Data warehouse or analytics database.
- Selling or sharing data with third parties (forbidden by the constitution).

## 9. Success metrics
- Database size stays under 350 MB for 12 months.
- Quarterly restore test passes.

## 10. Owner decisions (2026-10-03)
The reviewer questions of the draft were answered by the owner; the answers are applied above.

| Question | Decision |
|---|---|
| 1. 7 days for anonymous shared result links? | Yes. |
| 2. 13 months for feedback data? | Yes. |
| Extra (from 009) | New dataset "signed-out saved items", kept 90 days after last use (inventory above). |
