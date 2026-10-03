# Spec 006 — Pricing, Price Sections and Price Range Filter

| Field | Value |
|---|---|
| Spec ID | 006 |
| Area code | `PRC` |
| Status | Approved (2026-10-03) |
| Depends on | 005, 007, 010 |
| Tech file | [tech.md](./tech.md) |
| Last updated | 2026-10-03 |

## 1. Why (problem and value)
Budget is the first filter most people apply, yet domain prices are confusing: first-year promotions,
much higher renewals, multi-year minimums, premium names, resale listings, and country extensions with
eligibility rules. The owner asked for results grouped into **Free, $1–100, $101–300 and $300+**, plus a
**price range control** so users can see exactly the names they can afford. Showing honest, sourced prices
(including the renewal price) prevents unpleasant surprises and builds trust.

## 2. What (scope summary)
- Every paid recommendation shows its **upfront price** (what you pay today), its **renewal price** per year,
  and **where** the price comes from.
- Results are grouped into four sections by upfront price, labelled only by their price ranges: **Free** ($0),
  **$1–100** ($0.01–$100), **$101–300** ($100.01–$300), **$300+** (above $300). The $300+ section is hidden when it
  has nothing to show and no data source for it exists.
- A **two-handle price range slider** (from $0 to "$10,000+") with typed minimum/maximum boxes and one-click
  presets for each section filters all results instantly.
- A **"Find more in this range"** button fetches new names specifically in the chosen budget.
- Prices, the slider and section labels can be shown in **any supported currency the user picks** (approximate
  conversion) — e.g. someone in Japan building a global site can see costs in yen.
- Prices come from registrars that give free, permitted access to their prices (the ones listed in research R-04/R-05).
- Price data is refreshed every day.

## 3. User stories and acceptance criteria

### US-1 See prices clearly
As a visitor, I want to see what a name costs now and later.
- **Given** a result `sunnycrust.shop` **When** I look at it **Then** I see "$1.99 first year · renews $32.00/yr · price from <registrar>",
  and a warning badge because the renewal is much higher than the first year.

### US-2 Sections by price
As a visitor, I want results grouped by budget.
- **Given** results **When** the page loads **Then** I see sections Free, $1–100, $101–300 and $300+ with a count each; empty
  sections show a short explanation and a "Find more" action.

### US-3 Price range slider
As a visitor with a budget of $10–$50, I want to see only those names.
- **Given** results are loaded **When** I drag the handles (or type 10 and 50) **Then** within a moment only results whose
  price is between $10 and $50 remain, section counts update, and the page address remembers the range.

### US-4 Filter by renewal price
As a visitor who cares about yearly cost, I want to filter by renewal price instead.
- **Given** the toggle "Filter by: first year / renewal" **When** I choose "renewal" **Then** the slider applies to renewal prices.

### US-5 Find more in my range
As a visitor who found few names in my budget, I want more.
- **Given** range $100–$300 has 3 results **When** I press "Find more in this range" **Then** new names priced in that range are
  added (e.g. using extensions priced in that band), without repeating earlier names.

### US-6 My currency
As a visitor in Japan building a website for a global audience, I want to see what names cost me in yen.
- **Given** I choose JPY **When** results show **Then** prices, the slider and the section labels appear in yen (e.g. "≈ ¥1,450"),
  with a note that conversion is approximate and the registrar charges in its own currency; my choice is remembered.
- **Given** I choose INR instead **When** results show **Then** prices appear as "≈ ₹166" in the same way.

### US-7 Rules and restrictions
As a visitor, I want to know if an extension needs special eligibility.
- **Given** a `.us` result **When** I look at it **Then** I see "Requires US presence" before clicking Buy.

## 4. Functional requirements

| ID | Requirement | Priority |
|---|---|---|
| FR-PRC-001 | Every paid result MUST show upfront price, renewal price per year, price source, and currency. | MUST |
| FR-PRC-002 | The upfront price MUST be the lowest available first-year price across supported sources; for extensions with a multi-year minimum, it MUST be the total cost of that minimum term, with the term shown. | MUST |
| FR-PRC-003 | Results MUST be grouped by upfront price (in US dollars) into four sections labelled only by their price ranges: Free = $0; $1–100 = $0.01–$100.00; $101–300 = $100.01–$300.00; $300+ = above $300.00. The $300+ section MUST be hidden when it has no results and no premium or resale price source is enabled. | MUST |
| FR-PRC-004 | A two-handle price range control MUST cover $0 to "$10,000+" (or the equivalent in the chosen currency) with finer steps at lower prices, plus typed minimum and maximum inputs. | MUST |
| FR-PRC-005 | One-click presets MUST set the range to each section's boundaries, plus "All". | MUST |
| FR-PRC-006 | Changing the range MUST filter all loaded results instantly and update each section's count. | MUST |
| FR-PRC-007 | The chosen range and price basis MUST be stored in the page address so it can be shared and survives reload. | MUST |
| FR-PRC-008 | Users MUST be able to switch the filter basis between upfront price and renewal price. | MUST |
| FR-PRC-009 | "Find more in this range" MUST request additional names targeted at the selected price band, excluding names already shown. | MUST |
| FR-PRC-010 | Users MUST be able to switch the display currency at any time, choosing from every currency the daily rate source supports (at least USD, EUR, GBP, JPY, INR, CNY, CAD, AUD, CHF, SGD). Prices, the slider and section labels MUST then use that currency and be marked approximate; section boundaries stay defined in US dollars. The default MUST follow the visitor's browser region when supported (otherwise USD), and the choice MUST be remembered. | MUST |
| FR-PRC-011 | Extension prices MUST be refreshed at least daily, and the time of the last refresh MUST be visible. | MUST |
| FR-PRC-012 | Registry-premium names MUST show a "Premium name" badge and the sourced premium price when known; when a premium price may apply but is unknown, the result MUST say "Premium price possible — confirm at registrar". | MUST |
| FR-PRC-013 | Resale (aftermarket) listings MAY be shown in the $300+ section with the marketplace name, when a permitted data source is configured. When no such source exists and no other result falls above $300, the section is hidden (FR-PRC-003). | MAY |
| FR-PRC-014 | Extensions with eligibility rules or special requirements MUST show a clear warning. | MUST |
| FR-PRC-015 | When the renewal price is more than twice the first-year price, a warning badge MUST show the renewal price. | MUST |
| FR-PRC-016 | The system MUST NOT show invented or estimated prices; results without a sourced price MUST appear in a separate "Price at registrar" list outside the range filter. | MUST |
| FR-PRC-017 | Each paid result MUST have a "Buy" link to a registrar page for that exact name; no affiliate parameters while on a non-commercial hosting plan. | MUST |
| FR-PRC-018 | Free results MUST always be included when the range minimum is $0 (and the user has not turned free results off). | MUST |

## 5. Non-functional requirements

| ID | Requirement | Target |
|---|---|---|
| NFR-PRC-001 | Filter response for 500 loaded results | < 100 ms |
| NFR-PRC-002 | Price data age | < 30 h (warning shown beyond) |
| NFR-PRC-003 | Slider accessibility | keyboard operable, announces values to screen readers (WCAG 2.2 AA) |
| NFR-PRC-004 | Price correctness vs source at refresh time | 100% (automated comparison) |

## 6. Data used (conceptual)
- Per extension: registration, renewal and transfer prices per source; minimum term; eligibility rules; whether premium names exist; last refresh time.
- Per name: premium price (if known), resale listings (if a source exists).
- Currency rates (daily).
- Per result: upfront price, renewal price, section, source.

## 7. Edge cases and failure behavior

| Situation | Expected behavior |
|---|---|
| Two sources give different prices | Lowest upfront shown; the other listed on hover/expand. |
| Price data refresh fails | Keep last prices; show age; warning after 30 h. |
| Promotional first-year price with no end date | Shown as sourced, with renewal price beside it. |
| Range min > max typed | Values swapped automatically. |
| Range excludes everything | Empty state with "Find more in this range" and "Reset range". |
| Currency rates unavailable | Fall back to USD display with a notice. |

## 8. Out of scope
- Price history charts (data is kept; charts may come later).
- Coupon codes and bulk discounts.
- Taxes/VAT calculation (registrars add these at checkout; noted in the UI).

## 9. Success metrics
- ≥ 40% of result pages have the range control or a preset used.
- < 1% of "Buy" clicks report a price mismatch (via feedback).

## 10. Owner decisions (2026-10-03)
The reviewer questions of the draft were answered by the owner; the answers are applied above.

| Question | Decision |
|---|---|
| 1. Section names (Free / Budget / Mid-range / Premium) or price ranges only? | Price ranges only: Free · $1–100 · $101–300 · $300+ (FR-PRC-003). |
| 2. Slider upper end | $10,000+ (FR-PRC-004), plus a currency switcher covering every supported currency (FR-PRC-010, US-6). |
| 3. Which registrars as price sources? | The registrars in research R-05 (with R-04's main source), each subject to free, permitted access. |
