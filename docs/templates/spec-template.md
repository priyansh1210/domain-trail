# Spec NNN — <Feature name>

| Field | Value |
|---|---|
| Spec ID | NNN |
| Area code | `XXX` (used in requirement IDs, e.g. `FR-XXX-001`) |
| Status | Draft – awaiting review |
| Depends on | <other spec IDs> |
| Tech file | [tech.md](./tech.md) |
| Last updated | YYYY-MM-DD |

> **Rule for this file:** a spec describes **what** we build and **why**. It must stay technology-agnostic:
> no framework, database, vendor, library or programming-language names. Those belong in `tech.md`.

## 1. Why (problem and value)
What problem does this feature solve for the user or for the product? What happens if we don't build it?

## 2. What (scope summary)
A short paragraph describing the feature from the user's point of view.

## 3. User stories and acceptance criteria
### US-1 <title>
As a <persona>, I want <capability> so that <benefit>.

- **Given** <context> **When** <action> **Then** <observable outcome>

## 4. Functional requirements
Keywords: **MUST** = required for release, **SHOULD** = strongly expected, **MAY** = optional.

| ID | Requirement | Priority |
|---|---|---|
| FR-XXX-001 | The system MUST … | MUST |

## 5. Non-functional requirements
| ID | Requirement | Target |
|---|---|---|
| NFR-XXX-001 | … | … |

## 6. Data used (conceptual)
What information this feature reads, creates or changes, described in plain words (not tables).

## 7. Edge cases and failure behavior
| Situation | Expected behavior |
|---|---|

## 8. Out of scope
Things this feature deliberately does not do (and where they live instead, if anywhere).

## 9. Success metrics
How we know the feature works well after launch.

## 10. Open questions for the reviewer
Numbered questions the product owner should answer during review.
