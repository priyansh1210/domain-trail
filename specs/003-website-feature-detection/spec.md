# Spec 003 — Website Feature Detection

| Field | Value |
|---|---|
| Spec ID | 003 |
| Area code | `FEAT` |
| Status | Approved (2026-10-03) |
| Depends on | 001, 002 |
| Used by | 004 (generation), 006 (extension choice by price), 008 (ranking), 009 (display) |
| Tech file | [tech.md](./tech.md) |
| Last updated | 2026-10-03 |

## 1. Why (problem and value)
The owner asked that the product "search every feature" of the described website before recommending names.
A good domain depends on *what kind* of site it is: an online bakery in Pune, a developer tool, and a charity
need very different words, extensions and tones. Detecting these features:
- makes the recommendations relevant (a developer tool gets `.dev`/`.io`, a store gets `.shop`, an Indian local
  business gets `.in`),
- lets the user **see and correct** what the system understood, which builds trust and improves results,
- gives every recommendation an understandable reason ("`.shop` suits online stores").

## 2. What (scope summary)
From the description, the system detects a **site profile** (site type, industry, audience, geography,
language, tone, preferred naming style), about **40 capability flags** (sells products, takes bookings,
aimed at developers, non-profit, local business…), and a **clarity rating**. These are shown as chips at the
top of the results page. The user can remove or change any chip, and the recommendations update without
retyping the description.

## 3. User stories and acceptance criteria

### US-1 See what was understood
As a visitor, I want to see what the system understood about my website.
- **Given** I searched "Online bakery in Pune delivering sourdough and cakes" **When** features are detected **Then** I see
  chips like "Online store", "Food & drink › Bakery", "Local customers", "India", "Friendly tone", "Sells products",
  "Food" within 2 seconds, before names appear.

### US-2 Correct a mistake
As a signed-in visitor, I want to fix a wrong detection.
- **Given** I am signed in and the chip "Country: Global" is wrong **When** I change it to "India" **Then** the recommendations
  refresh and include India-relevant extensions, without me retyping the description.
- **Given** I am signed out **When** I look at the chips **Then** they are read-only and offer "Sign in to edit".

### US-3 Understand uncertainty
As a visitor, I want to know which detections are uncertain.
- **Given** a detection has low confidence **When** chips are shown **Then** that chip is visually marked "unsure" and
  offers alternatives (the next most likely options).

### US-4 Works without the decision model
As a visitor, I still get sensible chips when the decision model is unavailable.
- **Given** degraded mode **When** I search **Then** features come from simpler rules, and a note says detection may be less accurate.

## 4. Functional requirements

| ID | Requirement | Priority |
|---|---|---|
| FR-FEAT-001 | The system MUST detect the site type from a fixed list of about 25 types (including "other"), with a confidence value. | MUST |
| FR-FEAT-002 | The system MUST detect the industry/topic from a fixed taxonomy of at most 200 entries, with a confidence value. | MUST |
| FR-FEAT-003 | The system MUST detect the main audience from a fixed list. | MUST |
| FR-FEAT-004 | The system MUST detect geographic scope: global, a region, or a specific country. | MUST |
| FR-FEAT-005 | The system MUST detect the main language of the future website. | MUST |
| FR-FEAT-006 | The system MUST rate the desired tone on a 5-level scale from playful to formal. | MUST |
| FR-FEAT-007 | The system MUST infer the most suitable naming style (descriptive, compound, brandable, personal name, playful, very short). | MUST |
| FR-FEAT-008 | The system MUST evaluate at least 40 capability flags, each with a probability, and treat a flag as present above a configurable threshold. | MUST |
| FR-FEAT-009 | The system MUST rate description clarity and trigger the "add more detail" prompt of spec 001 when it is too low. | MUST |
| FR-FEAT-010 | Detected features MUST be shown to the user as chips before any names appear; uncertain detections MUST be visibly marked. | MUST |
| FR-FEAT-011 | Signed-in users MUST be able to change or remove any detected feature; the system MUST then refresh recommendations using the edited features without repeating detection. Signed-out users MUST see the chips read-only, with an invitation to sign in to edit them. | MUST |
| FR-FEAT-012 | User-set preferences (e.g. country) MUST override detected values. | MUST |
| FR-FEAT-013 | Detected features MUST influence word choice, extension choice and naming style, and MUST be referenced in recommendation reasons. | MUST |
| FR-FEAT-014 | A rule-based fallback MUST produce features when the decision model is unavailable. | MUST |
| FR-FEAT-015 | Sensitive categories (adult, gambling, crypto, health, finance) MUST be detected so that extension rules and safety rules can apply. | MUST |

## 5. Non-functional requirements

| ID | Requirement | Target |
|---|---|---|
| NFR-FEAT-001 | Features shown after submit | p50 < 2 s, p95 < 4 s |
| NFR-FEAT-002 | Site-type top-1 accuracy on the evaluation set | ≥ 85% |
| NFR-FEAT-003 | Industry top-1 accuracy / top-3 accuracy | ≥ 75% / ≥ 90% |
| NFR-FEAT-004 | Country detection accuracy when a place is named | ≥ 95% |
| NFR-FEAT-005 | Capability-flag F1 on the evaluation set | ≥ 0.80 |
| NFR-FEAT-006 | Fallback site-type accuracy | ≥ 60% |

## 6. Data used (conceptual)
- Input: normalized description, user preferences.
- Output: the site profile, flags with probabilities, clarity rating, and which values were edited by the user.
- Stored with the search result (not linked to the description text for anonymous users).

## 7. Edge cases and failure behavior

| Situation | Expected behavior |
|---|---|
| Description mentions two countries | Pick the most likely; show the second as an alternative on the chip. |
| Description is a personal site with no industry | Industry chip shows "Personal" and is marked unsure. |
| Contradictory flags (non-profit + sells products) | Both allowed; extension choice considers both. |
| User removes every chip | Recommendations fall back to keywords only and general extensions. |
| Non-English description | Detection runs normally; language chip shows the detected language. |

## 8. Out of scope
- Analyzing an existing website by its address.
- Detecting brand colors, logos or visual style.
- Free-text feature labels invented by the system (only fixed lists are used, so results are predictable).

## 9. Success metrics
- < 15% of searches have any chip edited by the user (signals good detection).
- Searches with edited chips show higher "Buy/Save" rates afterwards than before editing.

## 10. Owner decisions (2026-10-03)
The reviewer questions of the draft were answered by the owner; the answers are applied above.

| Question | Decision |
|---|---|
| 1. Is the capability-flag list complete? | Enough for now; it may be extended later through a new question-catalog version. |
| 2. Chip editing for everyone or signed-in users only? | Signed-in users only (US-2, FR-FEAT-011). |
