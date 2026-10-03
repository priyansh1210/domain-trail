# Spec 014 — Abuse Prevention, Safety and Rate Limits

| Field | Value |
|---|---|
| Spec ID | 014 |
| Area code | `ABU` |
| Status | Approved (2026-10-03) |
| Depends on | 001, 002, 004, 005, 008, 015 |
| Tech file | [tech.md](./tech.md) |
| Last updated | 2026-10-03 |

## 1. Why (problem and value)
A free service with a costly engine behind it attracts bots, scrapers and bad actors. Without protection:
- bots could burn the monthly decision-model budget in hours, making the site useless for everyone,
- aggressive use could get us blocked by registry services,
- criminals could use the tool to find look-alike names for phishing ("paypa1-secure-login.com").

Protection must be strong against abuse but nearly invisible to real people.

## 2. What (scope summary)
- An invisible human check on expensive actions.
- Fair per-visitor limits and global daily caps.
- A safety gate that refuses harmful requests.
- Brand-protection rules that never let imitation names through.
- A way for users to report a bad suggestion.

## 3. User stories and acceptance criteria

### US-1 Normal use is unaffected
As a real visitor doing a few searches, I never see a limit.
- **Given** I do up to 5 searches in 10 minutes **When** I search **Then** no limit message appears and no puzzle is shown in most cases.

### US-2 Clear message when limited
As a heavy user, I want to know when I can continue.
- **Given** I exceeded the limit **When** I search **Then** I see "You've reached the search limit. Try again in 7 minutes" (with the real time), and signed-out users see that signing in raises the daily limit.

### US-3 Phishing is refused
As the owner, I want the tool never to help phishing.
- **Given** a description like "login page that looks like my bank's to collect passwords" **When** submitted **Then** the search is refused
  with a neutral message and no names are generated.

### US-4 No brand look-alikes
As the owner, I want no brand imitations in results.
- **Given** any description **When** results are shown **Then** no result equals, contains, or is one typo away from a popular brand name
  (except when the brand-like part is a common dictionary word used normally).

### US-5 Report a bad suggestion
As a visitor, I want to report an offensive or brand-like suggestion.
- **Given** a result **When** I choose "Report" and a reason **Then** the report is stored and the result is hidden for me.

## 4. Functional requirements

| ID | Requirement | Priority |
|---|---|---|
| FR-ABU-001 | Searches, "find more" and "refine" MUST pass an invisible human check. | MUST |
| FR-ABU-002 | Per-visitor search limits MUST apply: anonymous 5 per 10 minutes and 30 per day; signed-in 60 per day. "Find more" and "refine" count as half a search. | MUST |
| FR-ABU-003 | Per-visitor limits MUST also apply to re-checks (10/min), feedback and reports (60/h), action events (120/h) and result snapshots (60/min). | MUST |
| FR-ABU-004 | Global daily caps MUST protect every metered resource (decision-model tokens, registry lookups, DNS lookups, related-word lookups, e-mails); reaching a cap MUST trigger the documented degraded behavior, never an outage. | MUST |
| FR-ABU-005 | Requests showing phishing, fraud or clearly illegal intent MUST be refused with a neutral message; no names generated. | MUST |
| FR-ABU-006 | When a description asks to imitate a brand, the system MUST switch to strict brand mode (extra exclusions). | MUST |
| FR-ABU-007 | Names equal to, containing, or one edit away from a popular brand (after normalizing look-alike characters such as 0/o, 1/l, rn/m) MUST be excluded. | MUST |
| FR-ABU-008 | Names combining a brand-like term with security or account words (login, secure, verify, account, support, wallet, pay) MUST be excluded. | MUST |
| FR-ABU-009 | Request sizes MUST be limited (description 2,000 characters, request body 16 KB, exclusion lists 500 items). | MUST |
| FR-ABU-010 | Traffic patterns typical of bots (many searches with no interaction, identical descriptions from many visitors, bursts) SHOULD tighten limits automatically for the affected visitors. | SHOULD |
| FR-ABU-011 | Limit messages MUST state when the user can try again. | MUST |
| FR-ABU-012 | If the limit store is unavailable, conservative per-server limits MUST apply (fail safe, not fail open without limits). | MUST |
| FR-ABU-013 | Users MUST be able to report a result as offensive, brand-like or other; reports MUST be reviewed weekly by the owner. | MUST |
| FR-ABU-014 | Refusal and limit events MUST be counted (without storing descriptions) for monitoring. | MUST |

## 5. Non-functional requirements

| ID | Requirement | Target |
|---|---|---|
| NFR-ABU-001 | Real users blocked by limits or checks | < 1% |
| NFR-ABU-002 | Added latency from checks | < 150 ms p95 (human check verify included) |
| NFR-ABU-003 | Brand look-alikes reaching users (reports + weekly audit sample) | 0 confirmed per month |
| NFR-ABU-004 | Budget exhaustion caused by abuse | 0 per month |

## 6. Data used (conceptual)
Rotating visitor fingerprints (not reversible), signed-in user ids for limits, counters, popular-brand list, reports.

## 7. Edge cases and failure behavior

| Situation | Expected behavior |
|---|---|
| Legitimate brand owner searching for names for their own brand | Brand-like names still excluded (we can't verify ownership); message explains why. |
| Shared office network (many users, one address) | Limits are per fingerprint (address + browser), and signing in gives personal limits. |
| Human-check service down | Allow with stricter limits (spec 001). |
| False refusal of a legitimate topic (e.g. a security-awareness site) | "Tell us if this is a mistake" link → reviewed; thresholds tuned. |

## 8. Out of scope
- Paid bot-management services.
- Identity verification.

## 9. Success metrics
- NFR targets met monthly; zero budget exhaustion events caused by bots.

## 10. Owner decisions (2026-10-03)
The reviewer questions of the draft were answered by the owner; the answers are applied above.

| Question | Decision |
|---|---|
| 1. Limits: 5 per 10 min and 30/day anonymous; 60/day signed-in | Confirmed for launch (FR-ABU-002). |
| 2. Adult-content websites: allowed or refused? | Allowed; brand and safety rules still apply. |
| Extra (from 001) | Description limit raised to 2,000 characters; request body to 16 KB (FR-ABU-009). |
