# Spec 001 — Website Description Intake

| Field | Value |
|---|---|
| Spec ID | 001 |
| Area code | `INT` |
| Status | Approved (2026-10-03) |
| Depends on | 000, 014 (abuse), 003 (clarity check) |
| Tech file | [tech.md](./tech.md) |
| Last updated | 2026-10-03 |

## 1. Why (problem and value)
Everything the product recommends comes from what the user tells us. Most people don't know what makes a
good domain name, but they do know what their website is about. A single, friendly text box, with gentle help
when the description is too vague, makes it easy to start and makes the results better. Intake is also the
front door for abuse and cost, so it has to filter bad or automated requests before any expensive work starts.

## 2. What (scope summary)
The home page has a large text box ("Describe your website"), example chips that fill in sample descriptions,
and an optional "More options" panel for preferences. On submit the system validates the input, checks that the
visitor is human and within limits, reuses recent identical results when possible, and starts the search.
If the description is too vague, the user is asked for more detail before names are generated.

## 3. User stories and acceptance criteria

### US-1 Describe and search
As a visitor, I want to describe my website in my own words and start a search with one click.
- **Given** the home page **When** I type at least 20 characters and press "Find domains" **Then** the search starts
  and I am taken to a results page that begins showing progress within 1 second.

### US-2 Help with examples
As a visitor who doesn't know what to write, I want examples.
- **Given** the home page **When** I click an example chip ("Neighborhood bakery delivering sourdough bread and cakes") **Then** the
  text box is filled with it and I can edit before searching.

### US-3 Optional preferences
As a visitor with requirements, I want to set preferences.
- **Given** "More options" is open **When** I choose preferred extensions, maximum name length, "no hyphens",
  "no numbers", my country, and a price range **Then** the results respect these preferences.

### US-4 Vague description
As a visitor who wrote too little, I want to be told what to add.
- **Given** I type "my website" **When** I submit **Then** I see a message asking what the site offers and who it is for,
  with 2–3 guiding hints, and no names are generated until I add detail (I can choose "Search anyway").

### US-5 Instant repeat
As a visitor who repeats a search (or shares a link), I want instant results.
- **Given** the same description and preferences were searched in the last 24 hours **When** I submit **Then** results
  appear immediately from the stored copy, with fresh availability re-checks for anything older than its freshness window.

### US-6 Human check without friction
As a real visitor, I don't want puzzles.
- **Given** a normal browser **When** I submit **Then** the human check passes invisibly in most cases.

## 4. Functional requirements

| ID | Requirement | Priority |
|---|---|---|
| FR-INT-001 | The home page MUST offer a single text input for the website description with a visible character counter. | MUST |
| FR-INT-002 | The description MUST be 20–2,000 characters after trimming; outside this range the user MUST see a clear message and no search starts. | MUST |
| FR-INT-003 | The system MUST offer at least 6 example descriptions covering different site types. Examples MUST be globally neutral (no country-specific cities, currencies or customs). | MUST |
| FR-INT-004 | Optional preferences MUST include: preferred extensions (multi-select), maximum label length (6–20), allow hyphens (yes/no), allow digits (yes/no), country, and price range (min–max). | MUST |
| FR-INT-005 | Preferences MUST have sensible defaults (no hyphens, digits allowed, max length 15, country auto = from description, price range = all). | MUST |
| FR-INT-006 | Every search submission MUST pass a human-verification check and the rate limits of spec 014 before processing. | MUST |
| FR-INT-007 | The system MUST normalize descriptions (whitespace, Unicode normalization, invisible characters removed) before processing. | MUST |
| FR-INT-008 | Identical normalized description + preferences + pipeline version within 24 hours MUST reuse stored results (see US-5). | MUST |
| FR-INT-009 | If the clarity check rates the description as too vague, the user MUST be asked for more detail, with an option to continue anyway. | MUST |
| FR-INT-010 | Descriptions in any language MUST be accepted; the interface language is English in phase 1. | MUST |
| FR-INT-011 | Descriptions containing URLs, e-mail addresses or phone numbers SHOULD have these parts removed before processing, and the user SHOULD be told. | SHOULD |
| FR-INT-012 | The description MUST be kept only in the visitor's browser session for anonymous users (not stored on the server), per spec 013. | MUST |
| FR-INT-013 | Each search MUST receive a unique, unguessable identifier used in the results page address. | MUST |
| FR-INT-014 | The form MUST be fully usable with keyboard and screen readers. | MUST |

## 5. Non-functional requirements

| ID | Requirement | Target |
|---|---|---|
| NFR-INT-001 | Time from submit to results page showing progress | < 1 s p95 |
| NFR-INT-002 | Cache-hit response time | < 800 ms p95 |
| NFR-INT-003 | Human-check false-block rate | < 1% of real users |
| NFR-INT-004 | Home page weight | < 150 KB JS gzipped |

## 6. Data used (conceptual)
- Description text, preferences, a one-way fingerprint of description + preferences (for reuse), the search identifier.
- The human-check token (checked once, never stored).

## 7. Edge cases and failure behavior

| Situation | Expected behavior |
|---|---|
| Only emoji or symbols | Treated as too short/vague; message shown. |
| Pasted long text (> 2,000 chars) | Counter turns red; submit disabled; hint to shorten. |
| Description contains a brand name ("like Amazon but for books") | Allowed; brand words are not used in generated names (spec 014). |
| Human check service down | Allow submission with stricter rate limits (fail-open with limits). |
| User double-clicks submit | One search only (idempotent submit). |
| Preferences conflict (max length 6 + descriptive style) | Accept; results may be fewer; explain in empty state. |
| Browser without JavaScript | Home page shows a message that the search needs JavaScript. |

## 8. Out of scope
- Uploading files or a logo to describe the site.
- Voice input.
- Importing descriptions from an existing website address (possible later).

## 9. Success metrics
- ≥ 90% of started searches pass validation on the first try.
- < 10% of searches trigger the "too vague" prompt; of those, ≥ 50% add detail and continue.
- Cache-hit rate ≥ 15% after the first month.

## 10. Owner decisions (2026-10-03)
The reviewer questions of the draft were answered by the owner; the answers are applied above.

| Question | Decision |
|---|---|
| 1. Are 20–1,000 characters the right limits? | Minimum stays 20; maximum raised to 2,000 characters (FR-INT-002). |
| 2. Example chips tailored to India or globally neutral? | Globally neutral (FR-INT-003). |
