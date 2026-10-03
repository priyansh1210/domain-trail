# Spec 007 — Free Domain Sources (the "Free" section)

| Field | Value |
|---|---|
| Spec ID | 007 |
| Area code | `FREE` |
| Status | Approved (2026-10-03) |
| Depends on | 003, 004, 005, 010 |
| Tech file | [tech.md](./tech.md) |
| Last updated | 2026-10-03 |

## 1. Why (problem and value)
The owner wants a **Free** section. Many students, hobbyists, open-source maintainers and very early founders
cannot or do not want to pay for a domain yet. Truly free top-level domains largely disappeared when the
biggest free registry shut down in 2024, so today "free" means one of these:
- a **free subdomain service** (e.g. `yourname.is-a.dev`), usually requested through a public process,
- a **free domain from a community registry** that still gives away names under its own suffix,
- a **hosting platform address** you get automatically when you deploy a site (e.g. `yourname.<platform>.app`).

These options are scattered, each has different conditions, and availability is hard to check. Bringing them
into one section, with honest conditions and an availability check where possible, is valuable and unique.

## 2. What (scope summary)
For each search, the Free section lists the best names from the generated candidates on free providers that suit
the website (a developer project gets developer-oriented subdomains; any static site gets hosting-platform
addresses). Hosting-platform addresses are listed in their own group, **"Free hosting addresses"**, inside the Free
section, because they come with a hosting plan's rules (often non-commercial use only). Each result shows the provider, what you must do to get it (e.g. open a request on a public
repository, wait for manual approval, verify a phone number), typical waiting time, restrictions (e.g.
"developer projects only"), and whether the name appears to be free.

## 3. User stories and acceptance criteria

### US-1 Free options for my project
As a student building a portfolio, I want free address options.
- **Given** a description of a developer portfolio **When** results load **Then** the Free section shows names such as
  `priya.is-a.dev` and `priya-portfolio.<platform>.app` with their conditions.

### US-2 Understand the conditions
As a visitor, I want to know what getting a free name involves.
- **Given** a free result **When** I open its details **Then** I see the steps, expected waiting time, restrictions and a link to
  the provider's official instructions.

### US-3 Don't show dead options
As a visitor, I don't want to waste time on providers that no longer work.
- **Given** a provider stopped accepting requests **When** the daily health check detects it **Then** it is hidden or marked
  "currently not accepting requests".

## 4. Functional requirements

| ID | Requirement | Priority |
|---|---|---|
| FR-FREE-001 | The system MUST keep a curated list of free providers with: name, suffix, type (subdomain service / community registry / hosting platform address), eligibility rules, steps, typical waiting time, official link, and how availability can be checked. | MUST |
| FR-FREE-002 | The Free section MUST show only providers whose eligibility rules fit the detected website (e.g. developer-only services for developer projects). | MUST |
| FR-FREE-003 | For each shown free name, availability MUST be checked with the provider's permitted method, or the result MUST say "availability not verifiable". | MUST |
| FR-FREE-004 | Each free result MUST display its conditions and steps before the user leaves the site. | MUST |
| FR-FREE-005 | Provider health (still accepting requests, check method working) MUST be verified daily; unhealthy providers MUST be hidden or clearly marked. | MUST |
| FR-FREE-006 | Free names MUST follow the same safety, quality and preference rules as paid names. | MUST |
| FR-FREE-007 | Free results MUST be ranked by relevance and provider suitability, and limited to a reasonable number (default 15). | MUST |
| FR-FREE-008 | The Free section MUST explain briefly what free options are and their trade-offs (less professional, dependency on the provider, possible removal). | MUST |
| FR-FREE-009 | Adding, changing or removing a provider MUST NOT require changes outside the provider list and its checker. | MUST |
| FR-FREE-010 | The system MUST respect each provider's terms, including rules against automated checks. Providers whose terms forbid automated checking MUST be shown with "availability not verifiable". | MUST |
| FR-FREE-011 | Hosting-platform addresses MUST be shown in a separate group named "Free hosting addresses" within the Free section, with a note that they depend on the hosting plan's rules (for example, non-commercial use only). | MUST |

## 5. Non-functional requirements

| ID | Requirement | Target |
|---|---|---|
| NFR-FREE-001 | Free section ready | within 5 s of search start |
| NFR-FREE-002 | Accuracy of "appears free" | ≥ 95% |
| NFR-FREE-003 | Provider information reviewed by a person | at least quarterly |

## 6. Data used (conceptual)
- Provider list (curated), daily provider health, lists of names already taken on providers where such lists are public.
- Candidate names from spec 004.

## 7. Edge cases and failure behavior

| Situation | Expected behavior |
|---|---|
| Provider requires a public source-code project | Shown only for developer/open-source sites; condition displayed. |
| Provider's taken-list download fails | Use yesterday's list; mark check time. |
| All providers unsuitable | Section says "No suitable free options for this kind of site" and explains why. |
| Name taken on one platform but free on another | Each shown per provider. |

## 8. Out of scope
- Submitting requests to providers on the user's behalf.
- Hosting the user's site.
- Free domains bundled with paid hosting plans (they are not free).

## 9. Success metrics
- ≥ 25% of searches with developer/personal/non-profit profiles get a click on a free result.
- Zero providers shown that were not accepting requests for more than 2 days.

## 10. Owner decisions (2026-10-03)
The reviewer questions of the draft were answered by the owner; the answers are applied above.

| Question | Decision |
|---|---|
| 1. Count hosting-platform addresses as free domains or group them separately? | Separate group named "Free hosting addresses" (FR-FREE-011). This site itself runs on such an address for now. |
| 2. Providers to include or exclude? | No preference; the provider list follows research R-08. |
