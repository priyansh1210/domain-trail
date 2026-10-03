# Spec 016 — Testing and Quality

| Field | Value |
|---|---|
| Spec ID | 016 |
| Area code | `QA` |
| Status | Approved (2026-10-03) |
| Depends on | all feature specs |
| Tech file | [tech.md](./tech.md) |
| Last updated | 2026-10-03 |

## 1. Why (problem and value)
Spec-driven development only works if we can prove that what we built matches what the specs say. This product
also depends on things that change without warning — a new decision-model version, registry behavior, free-tier
rules — so quality checks must run continuously, not just once. Testing is how the constitution's principle
"a requirement without a test is not done" becomes real.

## 2. What (scope summary)
- Automated tests at several levels (unit, integration, contract, end-to-end) run on every change.
- An **evaluation set** of example descriptions measures detection, ranking and safety quality.
- Scheduled quality checks: weekly decision-model evaluation, monthly full-pipeline evaluation, monthly
  availability accuracy, nightly live smoke test.
- Accessibility, performance and security checks.
- A launch checklist and a rule that every bug gets a regression test.

## 3. User stories and acceptance criteria

### US-1 Safe changes
As the owner, I want broken changes blocked automatically.
- **Given** a change breaks a requirement's test **When** it is proposed **Then** it cannot be merged until fixed.

### US-2 Quality visible over time
As the owner, I want to see whether recommendations get better or worse.
- **Given** the weekly/monthly evaluations **When** I open the reports **Then** I see metric trends and any regressions highlighted.

### US-3 Know external services still work
As the owner, I want early warning if an external service changed.
- **Given** the nightly live smoke test **When** the decision model, a DNS resolver or a registry service changes behavior **Then** the test fails and I am alerted.

## 4. Functional requirements

| ID | Requirement | Priority |
|---|---|---|
| FR-QA-001 | Every FR and NFR MUST map to at least one automated test or an explicit, scheduled manual check (traceability matrices). | MUST |
| FR-QA-002 | Automated tests MUST run on every proposed change; failing checks MUST block merging. | MUST |
| FR-QA-003 | Automated tests MUST NOT depend on live external services; recorded responses MUST be used. | MUST |
| FR-QA-004 | An evaluation set MUST exist with at least 60 ordinary descriptions (varied site types, countries, and at least 8 non-English), 10 vague descriptions, 50 harmful requests and 50 harmless-but-tricky requests. | MUST |
| FR-QA-005 | The decision-model evaluation MUST run weekly; the full-pipeline evaluation MUST run monthly; both MUST publish reports with trends. | MUST |
| FR-QA-006 | Availability accuracy MUST be measured monthly (spec 005). | MUST |
| FR-QA-007 | Every page MUST pass automated accessibility checks; a manual screen-reader check MUST happen before launch and after major UI changes. | MUST |
| FR-QA-008 | Performance budgets (spec 009) MUST be checked automatically on preview deployments. | MUST |
| FR-QA-009 | A live smoke test MUST run nightly against real external services with a handful of known cases. | MUST |
| FR-QA-010 | Core logic packages MUST keep line coverage at or above 85%. | MUST |
| FR-QA-011 | Test data MUST NOT contain real personal data. | MUST |
| FR-QA-012 | A launch checklist MUST be completed before public launch (security baseline, legal review, backups restore, two-factor on all accounts, monitoring). | MUST |
| FR-QA-013 | Every confirmed bug MUST get a regression test before it is closed. | MUST |

## 5. Non-functional requirements

| ID | Requirement | Target |
|---|---|---|
| NFR-QA-001 | CI duration for a typical change | < 10 min |
| NFR-QA-002 | Flaky test rate | < 1% of runs |
| NFR-QA-003 | Time to detect an external-service behavior change | < 24 h |

## 6. Data used (conceptual)
Synthetic descriptions and names, recorded external responses, evaluation labels created by the owner (and a helper
the owner trusts; about 2–3 hours of labelling).

## 7. Edge cases and failure behavior

| Situation | Expected behavior |
|---|---|
| Recorded responses go out of date | Nightly live smoke test fails → re-record and review differences. |
| Evaluation labels disagree with good new behavior | Labels are updated by a reviewed change, with the reason recorded. |
| A test is flaky | Quarantined within 24 h, fixed within 7 days. |

## 8. Out of scope
Paid device labs, load testing beyond a small synthetic benchmark.

## 9. Success metrics
- Zero production incidents caused by changes that CI should have caught.
- Evaluation metrics meet the targets in specs 002, 003, 005, 008 for 3 consecutive months.

## 10. Owner decisions (2026-10-03)
The reviewer questions of the draft were answered by the owner; the answers are applied above.

| Question | Decision |
|---|---|
| 1. Can you help label the evaluation set? | Yes — the owner will label it (about 2–3 hours). |
