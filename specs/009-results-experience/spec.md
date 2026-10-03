# Spec 009 — Results Experience (Website UI)

| Field | Value |
|---|---|
| Spec ID | 009 |
| Area code | `UX` |
| Status | Approved (2026-10-03) |
| Depends on | 001, 003, 005, 006, 007, 008, 011 |
| Tech file | [tech.md](./tech.md) |
| API contract | [contracts/http-api.openapi.yaml](./contracts/http-api.openapi.yaml) |
| Last updated | 2026-10-03 |

## 1. Why (problem and value)
All the intelligence behind the product is only as good as the page that presents it. Users must understand
at a glance what the system understood, which names are available, what they cost now and later, and why
each is suggested — on a phone, with a screen reader, on a slow connection. A calm, fast, honest interface
turns a complex pipeline into a simple experience: *describe → see → choose*.

## 2. What (scope summary)
Pages: **Home** (description form), **Results**, **How it works**, **Status**, **Privacy**, **Terms**, and the
**Account** area (spec 011). The Results page shows detected-feature chips, the price range filter, currency and
price-basis controls, and the sections Free / $1–100 / $101–300 / $300+ plus "Price at registrar" ("Dropping soon"
is added in phase 2). On desktop the sections form one vertical list; on phones they become tabs.
Results stream in with visible progress. Each result card shows the name, status and check time, prices, badges,
reasons, and actions (Buy, Copy, Save/Watch, Re-check, thumbs up/down).

## 3. User stories and acceptance criteria

### US-1 Watch results arrive
As a visitor, I want to see progress instead of a blank page.
- **Given** I submitted a search **When** the results page opens **Then** I see a progress indicator with stages
  ("Understanding your site", "Creating names", "Checking availability", "Pricing") and placeholder cards, and real
  results replace placeholders as they arrive.

### US-2 Scan a result quickly
As a visitor, I want the key facts on each card.
- **Given** a result **When** I look at it **Then** I see: the name with its extension highlighted, "Available · checked 3 min ago",
  "$9.73 first year · renews $10.37/yr", source, up to 3 reasons, and actions.

### US-3 Act on a result
As a visitor, I want to buy, copy or save a name.
- **Given** a result **When** I press Buy **Then** the registrar page for that exact name opens in a new tab;
  **When** I press Copy **Then** the name is copied and a confirmation appears; **When** I press the star **Then** it is saved to my
  list right away — no sign-in needed (signed-out saves are kept on our server under a random browser identifier and move
  into my account if I sign in later).

### US-4 Share results
As a visitor, I want to share my results with a co-founder.
- **Given** results **When** I copy the page link and open it elsewhere **Then** the same features and results appear (with fresh
  availability), but my description text is not shown.

### US-5 Accessible streaming
As a screen-reader user, I want to hear progress without being overwhelmed.
- **Given** results are streaming **When** new results arrive **Then** a polite announcement summarizes ("12 more available names found")
  at most every 5 seconds.

### US-6 Know data freshness
As a visitor, I want to know how current the data is.
- **Given** any page **When** I look at the footer **Then** I see "Domain data updated 3 h ago" linking to the Status page.

## 4. Functional requirements

| ID | Requirement | Priority |
|---|---|---|
| FR-UX-001 | The Home page MUST contain the description form (spec 001), example chips, a 3-step "how it works" summary and links to Privacy and Terms. | MUST |
| FR-UX-002 | The Results page MUST show, top to bottom: feature chips, filter bar (price range, price basis, currency, sort), then sections Free, $1–100, $101–300, $300+ (hidden per spec 006 FR-PRC-003), Price at registrar; "Dropping soon" is added in phase 2. | MUST |
| FR-UX-003 | Each section MUST show its result count. On desktop, sections MUST be shown as one vertical list; on small screens, as tabs. | MUST |
| FR-UX-004 | Each result card MUST show: name (extension visually distinct), availability status with check time, upfront and renewal price with source, badges (Premium name, Restricted, Renewal warning, Unconfirmed), 1–3 reasons, and actions Buy, Copy, Save/Watch, Re-check, thumbs up/down. | MUST |
| FR-UX-005 | Results MUST stream in with a staged progress indicator and placeholder cards; the layout MUST NOT jump when results arrive. | MUST |
| FR-UX-006 | The results link MUST be shareable; opening it elsewhere MUST show features and results without the description. | MUST |
| FR-UX-007 | Each section MUST offer "Show more" and, when short, "Find more in this range". | MUST |
| FR-UX-008 | Empty states MUST explain why a section is empty and offer an action (find more, relax preferences, reset range). | MUST |
| FR-UX-009 | Banners MUST inform about degraded mode, paused availability checks, stale data, or refusals, in plain language. | MUST |
| FR-UX-010 | A "How it works" page MUST explain the process, data sources, what "available" means, and limitations. | MUST |
| FR-UX-011 | A public Status page MUST show when each type of domain data was last refreshed and whether systems are healthy. | MUST |
| FR-UX-012 | Privacy and Terms pages MUST exist and be linked from every page footer (content per spec 013). | MUST |
| FR-UX-013 | Every page MUST meet WCAG 2.2 AA, be keyboard operable, and announce streamed results politely. | MUST |
| FR-UX-014 | The interface MUST work well from 360 px wide screens up to desktop. | MUST |
| FR-UX-015 | The interface SHOULD follow the device's light/dark preference. | SHOULD |
| FR-UX-016 | Result pages MUST NOT be indexed by search engines; marketing pages MUST be indexable with proper titles and descriptions. | MUST |
| FR-UX-017 | A disclaimer MUST state that availability can change at any time, prices come from registrars and exclude taxes, and we do not sell domains. | MUST |
| FR-UX-018 | Users MUST be able to sort a section by: best match (default), price low→high, shortest name. | SHOULD |
| FR-UX-019 | All interface text MUST be kept in one place so it can be translated later. | MUST |
| FR-UX-020 | Signed-out visitors MUST be able to save names and searches without signing in; saved items are stored on the server under a random identifier kept in the browser (spec 011). | MUST |

## 5. Non-functional requirements

| ID | Requirement | Target |
|---|---|---|
| NFR-UX-001 | Largest Contentful Paint (home, mid-range phone, 4G) | < 2.5 s |
| NFR-UX-002 | Cumulative Layout Shift | < 0.1 |
| NFR-UX-003 | Interaction to Next Paint | < 200 ms |
| NFR-UX-004 | Automated accessibility checks | 0 serious/critical violations |
| NFR-UX-005 | JavaScript on results page | < 250 KB gzipped |

## 6. Data used (conceptual)
Search results stream, detected features, price and currency data, freshness information, the visitor's saved-items and watchlist state.

## 7. Edge cases and failure behavior

| Situation | Expected behavior |
|---|---|
| Connection drops mid-stream | Automatic reconnect; if the search finished, the stored snapshot is loaded. |
| Shared link opened after results expired (7 days) | "These results have expired" + button to start a new search. |
| Refused request (safety) | Clear, non-judgmental message; no results. |
| Very long names | Truncated with full name on focus/hover; never breaks layout. |
| JavaScript disabled | Home explains that search needs JavaScript. |

## 8. Out of scope
- Native mobile apps.
- UI languages other than English (text is prepared for translation).
- Comparing domains side-by-side (possible later).

## 9. Success metrics
- ≥ 60% of results pages lead to at least one action (buy, copy, save, feedback).
- Median time to first action < 60 s.

## 10. Owner decisions (2026-10-03)
The reviewer questions of the draft were answered by the owner; the answers are applied above.

| Question | Decision |
|---|---|
| 1. Sections as vertical list or tabs? | Vertical list on desktop, tabs on mobile (FR-UX-003). |
| 2. Signed-out "Save": ask to sign in or keep a local list? | Store saved items in the database for everyone (FR-UX-020, spec 011). The owner can see them in a private admin view. The Privacy Policy states this in one line (spec 013); no pop-up or banner in the app. |
