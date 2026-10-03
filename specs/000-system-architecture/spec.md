# Spec 000 — System Overview and Architecture Requirements

| Field | Value |
|---|---|
| Spec ID | 000 |
| Area code | `SYS` |
| Status | Approved (2026-10-03) |
| Depends on | — (every other spec depends on this one) |
| Tech file | [tech.md](./tech.md) |
| Last updated | 2026-10-03 |

## 1. Why (problem and value)
Finding a good domain name is slow and frustrating. People type ideas one by one into registrar search
boxes, discover that almost everything is taken, and never find out which extensions suit their site or
what a name will really cost after the first year. Free options (subdomains) are scattered and hard to
compare. New domains are registered every day, so lists found online go stale quickly.

This product turns one paragraph ("describe your website") into a ranked, explained, **verified-available**
list of domain names grouped by price, refreshed daily, at zero cost to the user and to the operator.

## 2. What (scope summary)
A public website where a visitor:
1. describes the website they want to build (in their own words),
2. sees what the system understood about it (site type, industry, audience, country, tone, capabilities),
3. receives recommended domain names that are available right now, grouped into **Free**,
   **$1–100**, **$101–300** and **$300+** sections, and can narrow them with a **price range slider**,
4. can optionally sign in to save searches, watch domains and get alerts when something changes.

Behind the scenes, domain data (availability, prices, newly registered names, free providers) is refreshed
every day.

## 3. User journeys (end-to-end)

### J-1 Anonymous search
As a first-time founder, I want to describe my idea and get available names immediately, without an account.
- **Given** I open the home page **When** I type a description and press "Find domains"
  **Then** within 2 seconds I see what the system understood, within 5 seconds the first available names
  appear, and within 20 seconds the search is complete.

### J-2 Refine by budget
As a user with a fixed budget, I want to move a price slider and immediately see only names I can afford.
- **Given** results are shown **When** I set the range to $10–$60 **Then** only results whose first-year
  price is in that range remain visible, section counts update, and I can ask for more names in that range.

### J-3 Save and watch
As a signed-in user, I want to save a search and watch specific domains so I can decide later.
- **Given** I am signed in **When** I click "Save search" or the star on a domain **Then** it appears in my
  account and is re-checked every day.

### J-4 Daily alerts
As a signed-in user, I want to be told when a watched domain's status or price changes.
- **Given** I watch `sunnybakery.shop` **When** the daily re-check finds it was registered by someone else
  **Then** my account shows one daily digest notification that tells me, and the watchlist shows the new status.
  (Digest e-mails are added only once the site has its own domain — spec 011.)

## 4. Functional requirements (system level)

| ID | Requirement | Priority |
|---|---|---|
| FR-SYS-001 | The system MUST let anyone search without creating an account. | MUST |
| FR-SYS-002 | The system MUST turn a free-text description into detected features and ranked domain recommendations in one flow. | MUST |
| FR-SYS-003 | Every recommended paid domain MUST be verified available within its freshness window before it is shown as "available". | MUST |
| FR-SYS-004 | Results MUST be grouped into four price sections: Free ($0), $0.01–$100, $100.01–$300, and above $300. Sections are labelled only by their price ranges. The above-$300 section MUST be hidden when it has no results and no data source for it is available (spec 006). | MUST |
| FR-SYS-005 | Users MUST be able to filter all results with a minimum–maximum price range control. | MUST |
| FR-SYS-006 | Results MUST appear progressively (streamed) rather than after the whole search finishes. | MUST |
| FR-SYS-007 | Domain reference data (prices, extension list, free providers, newly registered names) MUST be refreshed at least once every 24 hours. | MUST |
| FR-SYS-008 | The system MUST keep working, with reduced ranking quality, when the decision model (Jev) is unavailable. | MUST |
| FR-SYS-009 | Users SHOULD be able to save searches and names (signed-out visitors included, spec 011); signed-in users SHOULD be able to watch domains and receive daily alert digests in the app. | SHOULD |
| FR-SYS-010 | The system MUST show a public status indicator of when domain data was last refreshed. | MUST |
| FR-SYS-011 | The product name and site address MUST be set in one configuration place, so the site can move from the free hosting address to its own domain later without code changes. | MUST |

## 5. Non-functional requirements (system level)

| ID | Requirement | Target |
|---|---|---|
| NFR-SYS-001 | Time to detected features shown | p50 < 2 s |
| NFR-SYS-002 | Time to first available domain shown | p50 < 5 s |
| NFR-SYS-003 | Time to complete search | p95 < 20 s |
| NFR-SYS-004 | Monthly operating cost | $0 (free tiers only; see constitution P1) |
| NFR-SYS-005 | Capacity on free tiers | ≥ 5,000 uncached searches/month; ≥ 200 searches/day |
| NFR-SYS-006 | Availability accuracy ("available" shown vs registrar truth) | ≥ 97% on the monthly sample |
| NFR-SYS-007 | Uptime of the search flow | ≥ 99% monthly (best effort on free tiers) |
| NFR-SYS-008 | Accessibility | WCAG 2.2 AA |
| NFR-SYS-009 | Supported devices | Last 2 versions of major browsers; phones ≥ 360 px wide |
| NFR-SYS-010 | Data freshness shown to user | "Updated X hours ago" never older than 30 h without a visible warning |

## 6. Data used (conceptual)
- User-provided: description, preferences, and for signed-in users: e-mail, saved searches, watchlist;
  for signed-out visitors who press Save: saved names and searches linked to a random browser identifier (no description text).
- Reference data: list of extensions, their prices and rules, free-subdomain providers, popular-site list,
  newly registered names, currency rates.
- Derived data: detected features, candidates, check results, recommendations, usage counters.

Details, owners and retention periods are specified in spec 012.

## 7. Edge cases and failure behavior

| Situation | Expected behavior |
|---|---|
| Description too short or meaningless | Ask for more details before searching (spec 001). |
| Decision model down or over budget | Degraded mode with a visible banner (spec 002, 015). |
| Registry lookups rate-limited | Show "checking…" then "unconfirmed — verify at registrar" instead of "available" (spec 005). |
| No available names in a section | Section shows an empty state and a "find more" action (spec 006, 009). The $300+ section is hidden instead when no data source for it exists. |
| Daily refresh failed | Keep last good data, show the age on the status indicator, alert the operator (spec 010, 015). |
| Harmful intent in description | Refuse politely; no names generated (spec 014). |

## 8. Out of scope (phase 1)
- Registering or selling domains, handling payments.
- Hosting, e-mail or website building for the user.
- Internationalized (non-ASCII) domain names.
- A public developer API.
- Languages other than English for the interface (descriptions in other languages are accepted).

## 9. Success metrics
- ≥ 60% of searches end with the user clicking "Buy", "Copy" or "Save" on at least one result.
- ≥ 70% positive feedback (thumbs up) on rated results.
- Availability accuracy ≥ 97%.
- $0 monthly bill for 3 consecutive months after launch.

## 10. Owner decisions (2026-10-03)
The reviewer questions of the draft were answered by the owner; the answers are applied above.

| Question | Decision |
|---|---|
| 1. Product name and the site's own domain | Launch on the hosting platform's free address (non-commercial use). The name and address are configuration (FR-SYS-011) so moving to an owned domain later is easy. |
| 2. Hide or explain an empty $300+ section without a data source | Hidden (FR-SYS-004). |
| 3. English-only UI in phase 1 | Yes. |
