# Spec 017 — Infrastructure and Deployment

| Field | Value |
|---|---|
| Spec ID | 017 |
| Area code | `INF` |
| Status | Approved (2026-10-03) |
| Depends on | 000, 012, 013, 015, 016 |
| Tech file | [tech.md](./tech.md) |
| Last updated | 2026-10-03 |

## 1. Why (problem and value)
The owner wants the project to be free. That means stitching together several free plans correctly, in the right
regions, with safe deployments, backups and clear instructions — so that the site can be run and repaired by one
person without surprise costs. Good infrastructure also makes the "spec → code" loop fast: every change gets its
own preview, and a bad release can be undone in minutes.

## 2. What (scope summary)
- A documented list of every service account, its free plan, region and owner.
- Preview deployments for every change; production deploys only from the main branch after all checks pass.
- Versioned database changes applied with approval.
- A one-command local development setup.
- Runbooks for common operations and emergencies.
- A documented (but not enabled) path to paid plans, with costs, for the owner's future decisions.

## 3. User stories and acceptance criteria

### US-1 Preview every change
As the owner, I want to try each change before it goes live.
- **Given** a proposed change **When** checks pass **Then** a preview link is posted on the change within 5 minutes.

### US-2 Undo a bad release
As the owner, I want to roll back quickly.
- **Given** production is broken after a release **When** I follow the rollback runbook **Then** the previous version is live within 5 minutes.

### US-3 Set up from zero
As a new maintainer, I want to run the project locally.
- **Given** a clean Windows, macOS or Linux machine **When** I follow the README **Then** the site runs locally with mocked external services within 30 minutes.

## 4. Functional requirements

| ID | Requirement | Priority |
|---|---|---|
| FR-INF-001 | Every hosted component MUST run on a free plan; the list of services, plans, regions and limits MUST be documented and re-verified quarterly. | MUST |
| FR-INF-002 | Every proposed change MUST get an automatic preview deployment. | MUST |
| FR-INF-003 | Production MUST deploy only from the main branch, only after all required checks pass. | MUST |
| FR-INF-004 | Database changes MUST be applied to production only through versioned migrations with explicit owner approval. | MUST |
| FR-INF-005 | All configuration and secrets MUST come from environment settings; a documented list with an example file (names only) MUST exist. | MUST |
| FR-INF-006 | Local development MUST start with a small number of documented commands and work offline with mocked external services. | MUST |
| FR-INF-007 | Rolling back to the previous production version MUST take under 5 minutes. | MUST |
| FR-INF-008 | Runbooks MUST exist for: deploy, rollback, secret rotation, database restore, re-enabling scheduled jobs, reactivating a paused database, budget exhaustion, incident response. | MUST |
| FR-INF-009 | A paid-upgrade path MUST be documented with approximate costs and triggers, but not enabled without owner approval. | MUST |
| FR-INF-010 | Hosting, database and function regions MUST be in India (Mumbai) and disclosed (spec 013). | MUST |
| FR-INF-011 | All service accounts MUST be owned by the project owner, protected with two-factor authentication, and listed with recovery information stored safely offline. | MUST |
| FR-INF-012 | The site MUST launch on a free platform-provided address; a custom domain is optional and requires owner approval. Switching later MUST be a configuration change only (spec 000 FR-SYS-011). | MUST |
| FR-INF-013 | Account setup MUST be documented step by step, in order, for a beginner. | MUST |
| FR-INF-014 | The code repository MUST be public; secrets, personal data and private keys MUST never be committed (spec 013). | MUST |

## 5. Non-functional requirements

| ID | Requirement | Target |
|---|---|---|
| NFR-INF-001 | Deploy duration (merge → live) | < 5 min |
| NFR-INF-002 | Local setup time | < 30 min |
| NFR-INF-003 | Monthly infrastructure cost | $0 |

## 6. Data used (conceptual)
Configuration values, secrets (held by providers), deployment history, backups.

## 7. Edge cases and failure behavior

| Situation | Expected behavior |
|---|---|
| Free database paused after inactivity | Runbook to restore; daily jobs normally prevent it. |
| Hosting plan limit reached | Alert (spec 015); degraded operation; owner decides on upgrade. |
| Scheduled jobs disabled by the platform after inactivity | Status page shows stale data; runbook to re-enable. |
| A provider discontinues its free plan | Swap using the documented alternatives list; spec change if behavior changes. |

## 8. Out of scope
Multi-region failover, containers/Kubernetes, infrastructure-as-code for providers that don't support it on free plans.

## 9. Success metrics
- 100% of releases via preview → main flow.
- $0 bills for 3 consecutive months.

## 10. Owner decisions (2026-10-03)
The reviewer questions of the draft were answered by the owner; the answers are applied above.

| Question | Decision |
|---|---|
| 1. Main user region | India (Mumbai) (FR-INF-010). |
| 2. Repository public or private? | Public (FR-INF-014). |
| 3. When to buy the site's own domain? | Not now — the site stays on the free platform address (FR-INF-012). |
