# Spec 008 — Ranking and Recommendations

| Field | Value |
|---|---|
| Spec ID | 008 |
| Area code | `RANK` |
| Status | Approved (2026-10-03) |
| Depends on | 002, 003, 004, 005, 006, 007 |
| Tech file | [tech.md](./tech.md) |
| Last updated | 2026-10-03 |

## 1. Why (problem and value)
After generation there are up to 1,000 name ideas, and each could pair with dozens of extensions. Users will
look at maybe 20. The order decides whether the product feels magical or useless. Ranking must put the
**most relevant, memorable, safe and affordable available** names first in each price section, explain *why*
each one is there, avoid showing ten versions of the same idea, and learn from user feedback over time.

## 2. What (scope summary)
Ranking happens in stages:
1. **Broad round:** the decision model compares all candidates in large groups and picks the most promising ~60.
2. **Deep round:** each of the top ~45 is rated for fit on a 5-level scale and checked for brand resemblance and
   unfortunate meanings; the model also rates which extensions suit the website.
3. **Pairing:** each shortlisted name is paired with its best-fitting extensions (and those in the user's budget).
4. **Final score:** relevance, quality, extension fit, keyword coverage and price value are combined; availability
   uncertainty lowers the score; unsafe names are excluded.
5. **Per-section ordering** with variety rules and 1–3 short reasons per result.

## 3. User stories and acceptance criteria

### US-1 Best names first
As a visitor, I want the best names at the top of each section.
- **Given** a completed search **When** I look at the $1–100 section **Then** the first 5 results are relevant to my site (evaluation:
  ≥ 70% judged "good fit" or better).

### US-2 Understand why
As a visitor, I want to know why a name is recommended.
- **Given** any result **When** I look at it **Then** I see 1–3 short reasons, e.g. "Contains your key word ‘sourdough’",
  "Short and easy to say", "‘.shop’ suits online stores".

### US-3 Variety
As a visitor, I don't want the same name with many extensions filling the list.
- **Given** results **When** I view a section **Then** no name appears with more than 3 extensions in that section, and
  multiple naming styles are represented.

### US-4 Give feedback
As a visitor, I want to say whether a suggestion is good.
- **Given** a result **When** I press thumbs up/down **Then** my vote is recorded anonymously and used to improve future rankings.

## 4. Functional requirements

| ID | Requirement | Priority |
|---|---|---|
| FR-RANK-001 | The system MUST rank candidates in a broad round over all candidates (in groups) and a deep round over the top ~45. | MUST |
| FR-RANK-002 | The deep round MUST rate each name's fit on a 5-level scale and estimate brand-resemblance and negative-meaning probabilities. | MUST |
| FR-RANK-003 | Names above the brand-resemblance or negative-meaning thresholds MUST be excluded. | MUST |
| FR-RANK-004 | The system MUST estimate how well each candidate extension suits the website and use it in ranking. | MUST |
| FR-RANK-005 | Each shortlisted name MUST be paired with its best-fitting extensions, the user's preferred extensions, and extensions in the user's selected price range. | MUST |
| FR-RANK-006 | The final score MUST combine relevance, quality, extension fit, keyword coverage and price value with configurable weights. | MUST |
| FR-RANK-007 | Unconfirmed availability MUST lower a result's rank; taken names MUST NOT be shown. | MUST |
| FR-RANK-008 | Each section MUST be ranked independently; default 20 results per section with "Show more". | MUST |
| FR-RANK-009 | Variety rules MUST apply: at most 3 extensions per name per section; no naming style above 40% of a section's top 20. | MUST |
| FR-RANK-010 | Each result MUST include 1–3 reasons generated from its actual scoring signals. | MUST |
| FR-RANK-011 | User preferred extensions MUST receive a ranking boost. | MUST |
| FR-RANK-012 | Users MUST be able to give thumbs-up/down feedback per result; feedback MUST be stored anonymously. | MUST |
| FR-RANK-013 | Feedback and "Buy/Copy/Save" actions SHOULD be used periodically to propose weight adjustments, which a person approves. | SHOULD |
| FR-RANK-014 | A deterministic ranking MUST be used when the decision model is unavailable. | MUST |
| FR-RANK-015 | "Dropping soon" names MUST be ranked in their own list (phase 2, with spec 005 FR-AVL-015). | SHOULD |
| FR-RANK-016 | When the user edits detected features, re-ranking MUST reuse unchanged decisions where possible. | SHOULD |

## 5. Non-functional requirements

| ID | Requirement | Target |
|---|---|---|
| NFR-RANK-001 | Ranking quality on evaluation set (NDCG@10 vs. human "good names") | ≥ 0.60 |
| NFR-RANK-002 | Final scoring + sectioning time | < 50 ms |
| NFR-RANK-003 | Reasons match signals (automated check) | 100% |
| NFR-RANK-004 | Degraded-mode quality (NDCG@10) | ≥ 0.40 |

## 6. Data used (conceptual)
Candidates with quality/coverage, decision-model answers, extension fit, availability results, prices and sections,
user preferences, anonymous feedback votes and click actions.

## 7. Edge cases and failure behavior

| Situation | Expected behavior |
|---|---|
| Fewer than 45 candidates survive | Deep round covers all; sections may be short; "Find more" offered. |
| All top names taken in popular extensions | Pairing tries more extensions within budget; then brandable styles fill. |
| Deep round partly fails | Missing ratings replaced by deterministic estimates for those names. |
| Feedback flood from one visitor | Rate-limited; only one vote per result per visitor counts. |

## 8. Out of scope
- Personalised ranking per signed-in user (phase 3 idea).
- Automatic weight changes without human approval.

## 9. Success metrics
- Thumbs-up rate ≥ 70%.
- Top-5 click share ≥ 50% of all result clicks.

## 10. Owner decisions (2026-10-03)
The reviewer questions of the draft were answered by the owner; the answers are applied above.

| Question | Decision |
|---|---|
| 1. Default results per section: 20? | OK (FR-RANK-008). |
| 2. Same name in several sections with different extensions? | Yes. |
