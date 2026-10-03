# Spec 005 — Domain Availability Checking

| Field | Value |
|---|---|
| Spec ID | 005 |
| Area code | `AVL` |
| Status | Approved (2026-10-03) |
| Depends on | 000, 004, 006 (premium prices), 010 (daily invalidation) |
| Tech file | [tech.md](./tech.md) |
| Last updated | 2026-10-03 |

## 1. Why (problem and value)
A recommendation is worthless if the name is already taken. Users lose trust instantly when they click "Buy" and
the registrar says "unavailable". New domains are registered every day, so yesterday's answer may be wrong today.
We need availability answers that are **accurate, fresh, fast, free** and **honest about uncertainty**, while being
polite to the public registry services we rely on.

## 2. What (scope summary)
For every domain name we intend to show, the system:
1. reuses a recent answer if it is still fresh,
2. otherwise does a quick, cheap check that rules out most registered names,
3. confirms the remaining names with the authoritative registry source,
4. marks names that are registered but about to expire as "dropping soon" (shown to users from phase 2),
5. flags names the registry sells at a premium price (with spec 006),
6. labels anything it could not confirm as "unconfirmed — verify at registrar".

Every result shows when it was last checked. Users can ask for a fresh re-check.

## 3. User stories and acceptance criteria

### US-1 Trustworthy "available"
As a visitor, I want names marked "available" to really be available.
- **Given** a name is shown as available **When** I open it at a registrar within the next hour **Then** it is
  available in at least 97 out of 100 cases (measured monthly).

### US-2 Know how fresh the answer is
As a visitor, I want to know when a name was checked.
- **Given** any result **When** I look at it **Then** I see "Checked 12 min ago" (or similar).

### US-3 Re-check a name
As a visitor about to buy, I want a fresh check.
- **Given** a result **When** I press "Re-check" **Then** within 3 seconds the status and check time update.

### US-4 Honest uncertainty
As a visitor, I want to be told when the system is not sure.
- **Given** the registry could not be reached **When** results are shown **Then** that name says "Unconfirmed — verify at
  registrar" and is ranked below confirmed names.

### US-5 Dropping-soon names (phase 2)
As a visitor, I want to know about good names that may become free soon.
- **Given** a relevant name is in its deletion period **When** results are shown **Then** it appears in a separate
  "Dropping soon" list with its expected release window, not among available names.

## 4. Functional requirements

| ID | Requirement | Priority |
|---|---|---|
| FR-AVL-001 | A name MUST only be labelled "available" after an authoritative registry check within its freshness window. | MUST |
| FR-AVL-002 | The system MUST use a fast preliminary check to rule out clearly registered names before authoritative checks. | MUST |
| FR-AVL-003 | Each check result MUST have one of these statuses: available, likely available (no authoritative source exists for that extension), available at premium price, taken, dropping soon, unknown. | MUST |
| FR-AVL-004 | Each result shown to users MUST display the time of its last check. | MUST |
| FR-AVL-005 | Freshness windows MUST be: available 6 hours, likely available 6 hours, premium 24 hours, taken 7 days, dropping soon 24 hours, unknown 1 hour (configurable). Expired results MUST be re-checked before being shown as available. | MUST |
| FR-AVL-006 | Results MUST be delivered progressively as checks complete. | MUST |
| FR-AVL-007 | The system MUST respect the rate limits of every registry service, slow down automatically when asked to, and never retry aggressively. | MUST |
| FR-AVL-008 | When no authoritative check is possible, the result MUST be labelled "likely available" or "unknown" with a link to verify at a registrar, and ranked below confirmed results. | MUST |
| FR-AVL-009 | Check results MUST be shared between searches (availability is public information) to reduce load and speed up results. | MUST |
| FR-AVL-010 | The daily newly-registered-domains data MUST mark previously "available" names as taken (spec 010). | MUST |
| FR-AVL-011 | For shortlisted available names in extensions known to have premium names, the system SHOULD detect premium status and price (spec 006). | SHOULD |
| FR-AVL-012 | Accuracy MUST be measured at least monthly by comparing a sample of results with a registrar's own check. | MUST |
| FR-AVL-013 | Daily limits on the number of checks MUST be enforced; when reached, cached results only, with a notice. | MUST |
| FR-AVL-014 | Users MUST be able to request a re-check of a single name, with a per-user limit. | MUST |
| FR-AVL-015 | "Dropping soon" names MUST be shown separately from available names, with their expected release window when known. Phase 2 — not shown in the first release. | SHOULD |

## 5. Non-functional requirements

| ID | Requirement | Target |
|---|---|---|
| NFR-AVL-001 | Accuracy of "available" | ≥ 97% |
| NFR-AVL-002 | Accuracy of "taken" | ≥ 99.5% |
| NFR-AVL-003 | Time to check 200 names (uncached) | p95 < 10 s |
| NFR-AVL-004 | Single re-check | p95 < 3 s |
| NFR-AVL-005 | Shared-answer (cache) hit rate after 1 month | ≥ 30% |
| NFR-AVL-006 | Load on any single registry service | ≤ its published limits; ≤ 5 requests/second per service by default |

## 6. Data used (conceptual)
- Per name: status, how it was checked, when, when it expires, premium price if known, expected release window.
- Per extension: which authoritative service answers for it, whether quick checks work for it.
- Daily list of newly registered names (spec 010).

## 7. Edge cases and failure behavior

| Situation | Expected behavior |
|---|---|
| Extension answers "exists" for every name in quick checks | Quick check skipped for that extension; authoritative check only. |
| Registry says "not found" but the name is reserved by the registry | May show as available; caught by premium/registrar checks or accuracy sampling; the extension is flagged if it happens often. |
| Registry service is slow or down | Name marked unknown after the time limit; re-checked later. |
| Name registered between our check and the user's click | Registrar shows unavailable; user can press Re-check; freshness windows keep this rare. |
| Many searches at once | Shared answers and rate limits keep registry load bounded; some names become "unknown". |

## 8. Out of scope
- Showing owner or contact details of registered names (privacy; not needed).
- Backordering or catching dropping names.
- Guaranteeing availability at purchase time (stated clearly in the UI and terms).

## 9. Success metrics
- Monthly accuracy report meets NFR-AVL-001/002.
- < 5% of shown results carry "unknown".
- Zero complaints or blocks from registry operators.

## 10. Owner decisions (2026-10-03)
The reviewer questions of the draft were answered by the owner; the answers are applied above.

| Question | Decision |
|---|---|
| 1. Show "Dropping soon" names in phase 1? | Later — phase 2 (US-5, FR-AVL-015). |
| 2. Is a 6-hour freshness window for "available" acceptable? | Yes (FR-AVL-005). |
