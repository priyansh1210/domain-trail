# Tech NNN — <Feature name>

| Field | Value |
|---|---|
| Implements | [spec.md](./spec.md) |
| Status | Draft – awaiting review |
| Owning packages | `packages/...`, `apps/web/...` |
| Last updated | YYYY-MM-DD |

> **Rule for this file:** tech.md describes **how** we build what `spec.md` asks for: components, stack,
> data model, interfaces, algorithms, limits, tests. Every requirement ID in spec.md must appear in the
> traceability matrix at the end.

## 1. Components and diagram
Which modules take part and how data flows between them.

## 2. Stack and libraries
| Concern | Choice | Version / notes |
|---|---|---|

## 3. Data model
Tables, columns, types, indexes, row-level-security (RLS) policies. Link to spec 012 for the full schema.

## 4. Interfaces
HTTP endpoints, events, TypeScript function signatures, contracts.

## 5. Algorithms and logic
Pseudocode for the non-trivial parts.

## 6. External services and free-tier limits
| Service | Used for | Free-tier limit | Source | Verified |
|---|---|---|---|---|

## 7. Configuration and secrets
| Env var | Where | Purpose |
|---|---|---|

## 8. Errors, retries and fallbacks
| Failure | Detection | Response |
|---|---|---|

## 9. Security and privacy controls

## 10. Performance and cost budgets

## 11. Test plan
Unit, contract, integration and end-to-end tests (see spec 016 for tooling).

## 12. Observability
Logs, metrics, alerts.

## 13. Traceability matrix
| Requirement | Component(s) | Test(s) |
|---|---|---|
| FR-XXX-001 | `packages/...` | `...test.ts` |

## 14. Risks and research links
Link open items in [docs/research.md](../../docs/research.md) (R-xx).
