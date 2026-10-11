# Spec 002 — Jev Decision-Model Integration

| Field | Value |
|---|---|
| Spec ID | 002 |
| Area code | `JEV` |
| Status | Approved (2026-10-03) |
| Depends on | 000 |
| Used by | 003 (feature detection), 004 (keyword weighting), 008 (ranking), 014 (safety gate), 015 (cost guard) |
| Tech file | [tech.md](./tech.md) |
| Question catalog | [questions/catalog.md](./questions/catalog.md) |
| Last updated | 2026-10-11 |

## 1. Why (problem and value)
The owner chose **Jev** (TypeSafe AI's decision model) as the intelligence of this product. Jev does not write
text; it answers typed questions (pick one of many options, place something on a scale, or say how likely a
statement is true) with probabilities. That makes it ideal for:
- understanding what a website is about (type, industry, audience, country, tone, capabilities),
- judging which generated names fit the website best,
- judging which extensions (.com, .shop, .in…) suit the site,
- spotting unsafe requests and names that imitate brands or read badly.

Because every search depends on it, the integration must be **reliable, predictable, versioned, testable,
affordable (free), and replaceable by a fallback** when it fails. A second reason for a dedicated spec is
change management: the questions we ask Jev are effectively product logic, so they must be reviewed,
versioned and tested like code.

## 2. What (scope summary)
One internal "decision service" through which every Jev call passes. It owns:
- the **question catalog** (every question the product asks, with an id and version),
- how questions are grouped into requests within Jev's size limits,
- which Jev model version is used,
- retries, timeouts and the fallback when Jev is unavailable,
- counting usage against the free monthly budget,
- recorded example answers so tests run without the network,
- a regular quality evaluation before any model upgrade.

## 3. User stories and acceptance criteria

### US-1 Reliable search even when Jev fails
As a visitor, I want my search to finish even if the decision model is down.
- **Given** Jev returns errors or times out **When** I search **Then** I still get results ranked by the fallback
  method, and a banner says ranking quality is reduced.

### US-2 Predictable behavior after model updates
As the owner, I want model upgrades to happen only after checking quality, so results don't silently change.
- **Given** TypeSafe publishes a new Jev version **When** the weekly evaluation runs **Then** a report file in the code
  repository compares the pinned version with the new one, and production keeps the pinned version until I approve the switch.

### US-3 Staying free
As the owner, I want Jev usage to stay inside the free monthly credit.
- **Given** 80% of the monthly budget is used **When** the threshold is crossed **Then** I get an alert; at 100%
  searches switch to degraded mode until the next month.

### US-4 Reviewable questions
As the owner, I want to read every question we ask Jev in one place.
- **Given** the catalog file **When** I open it **Then** I see each question's id, version, type, wording and options.

### US-5 AI answers for account holders who choose them
As the owner, I want the decision model used only for people with an account who switch on AI answers, so its
use (and its cost once credits are bought) stays tied to real accounts, and a visitor's description is sent to the
model only when they choose it.
- **Given** I am not signed in, or only have a guest session for saved items, **When** I search **Then** the
  decision model is not asked, the results come from the built-in rules, and no reduced-quality banner is shown.
- **Given** I am signed in and switched on AI answers **When** I search **Then** the decision model is asked; if it
  does not answer, I get the rules-based results with the reduced-quality banner of US-1.

## 4. Functional requirements

| ID | Requirement | Priority |
|---|---|---|
| FR-JEV-001 | All calls to Jev MUST go through a single internal decision service; no feature may call Jev directly. | MUST |
| FR-JEV-002 | Every question MUST be defined in the versioned question catalog (id, version, type, instructions, options/levels). Changing wording or options MUST create a new version. | MUST |
| FR-JEV-003 | Production MUST use a pinned, explicit model version (never a moving alias such as "latest"). | MUST |
| FR-JEV-004 | Every answer MUST be checked against the expected shape; malformed answers MUST be treated as failures. | MUST |
| FR-JEV-005 | Temporary failures (rate limit, overload, server errors) MUST be retried a limited number of times with increasing waits. | MUST |
| FR-JEV-006 | Each request MUST have a time limit; when a stage's decisions do not arrive in time, that stage MUST use the fallback. | MUST |
| FR-JEV-007 | When Jev fails repeatedly within a short period, the service MUST stop calling it for a cool-down period (fail fast) and use the fallback. | MUST |
| FR-JEV-008 | Token usage of every request MUST be recorded and aggregated per day and per month. | MUST |
| FR-JEV-009 | Daily and monthly token caps MUST be enforced before sending requests; when a cap is reached the product MUST switch to degraded mode. | MUST |
| FR-JEV-010 | The service MUST support a primary and a secondary access route to Jev, switchable by configuration without code changes. | MUST |
| FR-JEV-011 | The unique request identifier returned by Jev MUST be logged with each call for support. | MUST |
| FR-JEV-012 | Questions MUST be grouped into as few requests as possible while respecting Jev's size limits; independent groups MUST be sent in parallel. | MUST |
| FR-JEV-013 | Only the data needed for a decision (description, preferences, detected features, candidate names) MAY be sent to Jev; account data (e-mail, user ids) MUST NOT be sent. | MUST |
| FR-JEV-014 | Automated tests MUST be able to run without network access using recorded answers. | MUST |
| FR-JEV-015 | A quality evaluation on a fixed set of example descriptions MUST run at least weekly and before any model version change, producing a comparison report saved as a file in the code repository. | MUST |
| FR-JEV-016 | A fallback MUST exist for every question group (feature detection, keyword weighting, ranking, TLD fit, safety). | MUST |
| FR-JEV-017 | The system SHOULD cache decisions for identical inputs within a search session (e.g. re-ranking after the user edits a chip reuses unchanged answers). | SHOULD |
| FR-JEV-018 | The decision model MUST be asked only for searches by signed-in account holders (guest sessions do not count) who switched on AI answers. Every other search MUST use the fallback rules and send nothing to the model. | MUST |
| FR-JEV-019 | Whether AI answers apply MUST be decided on the server from the visitor's session; a request for AI answers from a visitor who is not signed in MUST be treated as AI answers off. Follow-up requests on the results page (more names, edited features) MUST follow the same rule. | MUST |
| FR-JEV-020 | Stored results MUST be reused only for a search with the same AI-answers setting, so a search without AI answers never shows results made with the model (and the other way round). | MUST |
| FR-JEV-021 | The reduced-quality banner and the degraded-mode count MUST apply only to searches with AI answers on; a search with AI answers off is not degraded and records no model usage. | MUST |

## 5. Non-functional requirements

| ID | Requirement | Target |
|---|---|---|
| NFR-JEV-001 | Latency of a single request | p95 < 1.5 s |
| NFR-JEV-002 | Total decision time per search (all stages) | p95 < 6 s |
| NFR-JEV-003 | Tokens per uncached search | ≤ 25,000 (target ~20,000) |
| NFR-JEV-004 | Monthly cost | ≤ the free monthly credit ($5), i.e. $0 billed |
| NFR-JEV-005 | Search success rate when Jev is fully down | 100% (degraded) |
| NFR-JEV-006 | Feature-detection accuracy on the evaluation set | ≥ 85% top-1 site type; ≥ 75% top-1 industry |

## 6. Data used (conceptual)
- Sent: website description, user preferences, detected features, lists of candidate names and extensions.
- Received: answers with probabilities, confidence values, token counts, request identifiers.
- Stored: daily/monthly token totals, per-search token totals, evaluation reports. Answers themselves are kept
  only as part of the search result (spec 012).

## 7. Edge cases and failure behavior

| Situation | Expected behavior |
|---|---|
| Jev returns an unknown option key | Treat that question as failed; use fallback for that question only. |
| Probabilities do not add up to ~1 | Normalize if within tolerance; otherwise treat as failed. |
| One request in a parallel group fails | Use answers from the successful ones; fallback for the failed questions. |
| Rate-limited during a traffic spike | Retry with waits; if still limited, fallback; alert if it happens often. |
| Budget exhausted mid-month | Degraded mode for all searches until the month resets; status page explains. |
| New model version behaves differently | No effect in production until approved via evaluation (US-2). |
| Description in a non-English language | Sent as-is; Jev evaluates it; evaluation set includes non-English examples. |
| A visitor signs out after a search with AI answers, then asks for more names | The new names come from the fallback rules (FR-JEV-019). |
| Someone opens a shared link to results made with AI answers | They see those results as stored; a new search they start follows their own sign-in and switch. |

## 8. Out of scope
- Generating names or any text with Jev (Jev cannot do this).
- Using any other AI model (would need a constitution-level decision).
- Training or fine-tuning.

## 9. Success metrics
- Degraded-mode share of searches < 2% per month (excluding budget exhaustion).
- $0 billed for Jev every month.
- Evaluation scores stable (±3 points) between weekly runs on the pinned version.

## 10. Owner decisions (2026-10-03)
The reviewer questions of the draft were answered by the owner; the answers are applied above.

| Question | Decision |
|---|---|
| 1. Budget exhausted mid-month: degraded mode or pause searches? | Degraded mode (US-3, FR-JEV-009). |
| 2. Evaluation report by e-mail or as a repository file? | A file in the repository is enough for now (FR-JEV-015). |

## 11. Owner decisions (2026-10-11): AI answers switch

| Question | Decision |
|---|---|
| 1. Who may use the decision model? | Only signed-in account holders, and only when they switch on AI answers (US-5, FR-JEV-018). |
| 2. Show the switch while the model is not reachable (no credits bought yet)? | Yes. When the switch is on and the model does not answer, the existing reduced-quality banner explains it (US-1, FR-JEV-021). The owner plans to buy credits later. |
| 3. What do signed-out visitors see? | A locked switch with a link to sign in (spec 001 FR-INT-015). |
| 4. Default for signed-in users? | Off until they switch it on; the choice is remembered on that browser (spec 001 FR-INT-015). |
