# Tech 006 — Pricing, Price Sections and Price Range Filter

| Field | Value |
|---|---|
| Implements | [spec.md](./spec.md) |
| Status | Approved (2026-10-03) |
| Owning packages | `packages/pricing`, `apps/web/components/price-range`, `jobs/refresh-prices` |
| Last updated | 2026-10-03 |

## 1. Components and diagram

```
jobs/refresh-prices (daily 01:00 UTC) ─┬─ PriceProvider[] ── getTldPrices() ──▶ tld_prices (+ tld_price_history on change)
                                       └─ FX provider ──────────────────────▶ fx_rates

pipeline S8 ── pricing.priceFor(fqdn, checkResult) ──▶ PricedResult { upfrontCents, renewalCents, minYears, source, tier }
                     uses: tld_prices (in-memory snapshot, refreshed every 10 min), tld_policies, premium results

"Find more" ── pricing.tldsInBand(minCents, maxCents) ──▶ TLD list for S3–S9 rerun

UI ── <PriceRangeFilter> (client) ── filters loaded results in memory; syncs ?min&max&basis&cur to URL
```

## 2. Stack and libraries

| Concern | Choice | Notes |
|---|---|---|
| Slider | shadcn/ui `Slider` (Radix, 2 thumbs) | ARIA built in; custom `aria-valuetext` |
| URL state | `nuqs` (type-safe search params for Next.js) | `?min=10&max=50&basis=upfront&cur=JPY` (min/max always in USD) |
| Money | integer cents + ISO 4217; `Intl.NumberFormat` for display | |
| FX | Frankfurter API (ECB reference rates) | free, no key (R-09) |

## 3. Data model (full DDL in spec 012)

```sql
create table tld_prices (
  tld text references tlds(tld), provider text,
  currency char(3) not null default 'USD',
  register_cents int, renew_cents int, transfer_cents int,
  is_promo boolean default false,
  fetched_at timestamptz not null,
  primary key (tld, provider)
);
create table tld_price_history (            -- rows only when a price changes
  tld text, provider text, register_cents int, renew_cents int, changed_at timestamptz,
  primary key (tld, provider, changed_at)
);
create table tld_policies (                 -- curated seed, reviewed quarterly (R-13)
  tld text primary key references tlds(tld),
  restriction text not null default 'none',  -- 'none' | 'local_presence' | 'eligibility' | 'blocked_for_public'
  restriction_note text,                     -- 'Requires US nexus'
  min_years smallint not null default 1,
  requires_https boolean default false,      -- .dev, .app, .page (HSTS preload)
  has_premium_names boolean default false,
  description text                           -- used in tld_fit@1 criteria
);
create table fx_rates (base char(3), quote char(3), rate numeric(18,8), as_of date, primary key (base, quote));
```

## 4. Interfaces

```ts
export type Tier = 'free' | 'budget' | 'mid' | 'premium';   // internal codes only — the UI labels sections
                                                           // by price range: Free · $1–100 · $101–300 · $300+

export interface PriceProvider {            // standard TLD prices
  id: string;                               // 'porkbun'
  getTldPrices(): Promise<Array<{ tld: string; registerCents: number; renewCents: number;
    transferCents?: number; currency: string; isPromo?: boolean }>>;
  buyUrl(fqdn: string): string;             // registrar search/checkout page for the name
}
export interface PremiumProvider {          // registry premium detection
  id: string; mode: 'live' | 'background';
  maxBatch: number; minIntervalMs: number;
  checkPremium(fqdns: string[]): Promise<Array<{ fqdn: string; premium: boolean;
    registerCents?: number; renewCents?: number; currency?: string }>>;
}
export interface AftermarketProvider {      // resale listings (phase 3)
  id: string; search(labels: string[]): Promise<Array<{ fqdn: string; priceCents: number;
    currency: string; marketplace: string; url: string }>>;
}

export function tierOf(upfrontUsdCents: number): Tier;
export function showPremiumSection(premiumCount: number, cfg: { premiumProviders: string[]; aftermarketProviders: string[] }): boolean;
export function sectionLabel(tier: Tier, currency: string, fx: FxTable): string;   // e.g. "≈ ¥15,000–45,000"
export function priceFor(fqdn: string, check: CheckResult): PricedResult | { unpriced: true };
export function tldsInBand(minCents: number, maxCents: number | null, pool: string[]): string[];
```

## 5. Algorithms and logic

### 5.1 Tier function (FR-PRC-003)
```ts
export function tierOf(c: number): Tier {
  if (c === 0) return 'free';
  if (c <= 10_000) return 'budget';     // $0.01 – $100.00
  if (c <= 30_000) return 'mid';        // $100.01 – $300.00
  return 'premium';                     // > $300.00
}
```

Section visibility (FR-PRC-003): `showPremiumSection = premiumCount > 0 || premiumProviders.length > 0 ||
aftermarketProviders.length > 0`. When false, the $300+ section and its preset are hidden (no empty state).

Section labels: boundaries stay in USD; in another currency they are converted and rounded to 2 significant figures
("$1–100" → "≈ ¥150–15,000"). Free is always "Free".

### 5.2 Upfront and renewal price (FR-PRC-002)
```
for each provider p with a row for tld:
   first = premium?.registerCents ?? p.register_cents
   renew = premium?.renewCents   ?? p.renew_cents
   upfront = first + (policy.min_years - 1) * renew
choose provider with min upfront (tie → lower renew)
convert to USD cents if provider currency ≠ USD (fx_rates) → tier
if no provider row and no premium price → unpriced (FR-PRC-016)
if check.status == 'available' and policy.has_premium_names and no premium check done → flag premiumPossible (FR-PRC-012)
renewWarning = renew > 2 * first (FR-PRC-015)
```

### 5.3 Providers
| Adapter | Kind | Status | Access |
|---|---|---|---|
| `porkbun-pricing` | PriceProvider | **phase 1** | `GET https://porkbun.com/api/json/v3/pricing/get` — no auth; returns `pricing.{tld}.{registration,renewal,transfer}` as USD strings (R-04 verifies format/ToS). `buyUrl`: `https://porkbun.com/checkout/search?q={fqdn}` |
| `porkbun-check` | PremiumProvider (background) | phase 2 | `checkDomain` with free API key, 1 check/10 s → used only by a job that pre-checks premium status of frequently recommended available names (≤ 8,000/day theoretical, capped at 2,000/day) |
| `namecom-pricing` / `dynadot-pricing` | PriceProvider | **phase 1 if R-05 confirms free access + ToS** (owner chose the R-05 registrars as extra price sources) | their TLD price lists via free API accounts; adds a second/third price per TLD so FR-PRC-002 can pick the lowest |
| `namecom-check` / `dynadot-search` | PremiumProvider (live) | phase 2, if R-05 confirms free access + ToS | batch checks (≤ 50/100 names per call) for shortlisted names during search |
| `aftermarket-*` | AftermarketProvider | phase 3, R-06 | e.g. Sedo partner API if free access is granted |

Additional PriceProviders can be added without code changes elsewhere (registered in `providers/index.ts`).

### 5.4 Price range control (FR-PRC-004…008, 018)
Scale: slider position `s ∈ [0, 1000]`.
```
price(s) = 0                                  if s == 0
         = round125(10^( (s/1000) * log10(10000) ))  for 0 < s < 1000  // $1 … $10,000
         = ∞ ("$10,000+")                     if s == 1000
round125: snap to 1-2-5 style steps: <$10 → $1 steps, <$100 → $5, <$1,000 → $25, <$5,000 → $100, else $250
```
- The scale is defined in USD; labels, `aria-valuetext` and typed inputs use the display currency
  (`value × fx_rate`, rounded for display), converted back to USD cents for filtering.
- Display currency (FR-PRC-010): `<CurrencySelect>` lists every currency in today's `fx_rates` (~30 from ECB rates).
  Default: region of `navigator.language` → currency (e.g. `ja-JP` → JPY) when supported, else USD. The choice is kept
  in the URL (`cur`) and `localStorage`, and in `profiles.currency` for signed-in users.
- Presets: All (0–∞), Free (0–0), $1–100 (1–100), $101–300 (100.01–300), $300+ (300.01–∞).
- Filtering: `results.filter(r => inRange(basis === 'upfront' ? r.upfrontUsdCents : r.renewUsdCents))`; free results
  (0) included when min = 0 and `includeFree`. Unpriced list is always shown separately (not filtered).
- URL sync through `nuqs` with 300 ms debounce; `aria-valuetext` like "Minimum 10 dollars".
- Performance: results kept in a memoized array; filtering 500 items is O(n) < 5 ms.

### 5.5 "Find more in this range" (FR-PRC-009)
```
POST /api/search/{id}/more { description, priceMinCents, priceMaxCents, basis, exclude: string[] (≤ 500) }
tlds = tldsInBand(min, max, tldPool(profile))   // TLDs whose upfront price ∈ band (+ neighbours ±10%)
if band.min ≥ 30_000 and no premium/aftermarket provider configured:
      prefer short labels (≤ 6 chars) on TLDs with has_premium_names (premium-possible) and expensive-TLD registrations
rerun S3 (exclude seen) → S4 → S5/S6 → S7 → S8 → S9 with those TLDs; stream as normal
counts as 0.5 search for rate limits (spec 014)
```

### 5.6 Daily price refresh (see spec 010)
```
rows = porkbun.getTldPrices()
validate: ≥ 300 TLDs, com price between $5 and $30 (sanity), no negative/NaN
upsert tld_prices; for changed (register or renew) insert tld_price_history
mark tlds.priced = true for TLDs with any price row
fx = GET https://api.frankfurter.app/latest?from=USD   (all ~30 ECB currencies)  → upsert fx_rates
```
(If the sanity check fails, keep yesterday's data and alert.)

## 6. External services and free-tier limits

| Service | Used for | Limit | Source | Verified |
|---|---|---|---|---|
| Porkbun pricing endpoint | TLD prices | no auth; once per day is our use | porkbun.com/api/json/v3/documentation | 2026-09-29 (R-04 ToS) |
| Porkbun checkDomain | background premium checks, accuracy sample | 1 check / 10 s, free API key | porkbun.com/api/json/v3/documentation | 2026-09-29 |
| Frankfurter | FX | free, no key | frankfurter.app | R-09 |
| Name.com / Dynadot | live premium checks (optional) | to verify | — | R-05 |

## 7. Configuration and secrets

| Env var | Where | Purpose |
|---|---|---|
| `PRICE_PROVIDERS` | Actions | e.g. `porkbun-pricing,namecom-pricing,dynadot-pricing` (only those R-05 clears) |
| `PREMIUM_PROVIDERS` | Vercel, Actions | e.g. `porkbun-check:background` |
| `PORKBUN_API_KEY`, `PORKBUN_SECRET_KEY` | Actions only | premium background job |
| `DISPLAY_CURRENCIES` | config | `all` (every currency in `fx_rates`); a comma list narrows it |
| `NAMECOM_API_USER`, `NAMECOM_API_TOKEN`, `DYNADOT_API_KEY` | Actions only | extra price sources (if R-05 clears them) |
| `PRICE_STALE_HOURS` | config | 30 |

## 8. Errors, retries and fallbacks

| Failure | Response |
|---|---|
| Pricing endpoint down / sanity fail | keep previous data; `job_runs` failure; UI stale warning after 30 h |
| FX down | show USD only, notice |
| Premium provider error | `premiumPossible` flag instead of price |
| Unknown TLD price | `unpriced` list |

## 9. Security and privacy controls
- Registrar keys only in GitHub Actions secrets (background jobs) or server env; never client-side.
- Buy links are plain registrar URLs (no tracking parameters), `rel="noopener noreferrer"`.

## 10. Performance and cost budgets
- `priceFor` O(1) from an in-memory snapshot of `tld_prices` (~1,000 TLDs × providers, < 200 KB), refreshed every 10 min per instance.
- Filtering in the browser, no network.

## 11. Test plan

| Test | Type | What it proves |
|---|---|---|
| `tier.test.ts` | unit | boundaries: 0, 1, 10_000, 10_001, 30_000, 30_001 |
| `section-visibility.test.ts` | unit | $300+ hidden when empty and no premium/aftermarket provider; labels per currency |
| `price-for.test.ts` | unit | lowest provider, min_years upfront, premium override, renew warning, unpriced |
| `porkbun-adapter.test.ts` | unit + MSW | parsing, sanity checks |
| `refresh-prices.int.test.ts` | integration | upsert + history on change only |
| `slider-scale.test.ts` | unit | position↔price mapping, rounding, ∞ |
| `tlds-in-band.test.ts` | unit | band selection incl. neighbours |
| `price-range.spec.ts` | e2e | drag + typed values, presets, counts, URL persistence, keyboard, axe |
| `find-more.spec.ts` | e2e | new results within range, no repeats |
| `currency.spec.ts` | e2e | JPY and INR display (prices, slider, section labels), ≈ notice, default from browser locale, remembered choice |

## 12. Observability
Metrics: price refresh success/age, TLD count priced, % results unpriced, % premium-possible, slider/preset usage, find-more usage by band.

## 13. Traceability matrix

| Requirement | Component(s) | Test(s) |
|---|---|---|
| FR-PRC-001 | `PricedResult`, `<ResultCard>` | `price-for.test.ts`, `results.spec.ts` |
| FR-PRC-002 | `priceFor` §5.2 | `price-for.test.ts` |
| FR-PRC-003 | `tierOf`, `showPremiumSection`, `sectionLabel` | `tier.test.ts`, `section-visibility.test.ts` |
| FR-PRC-004 | `<PriceRangeFilter>` scale §5.4 ($0–$10,000+) | `slider-scale.test.ts`, `price-range.spec.ts` |
| FR-PRC-005 | presets | `price-range.spec.ts` |
| FR-PRC-006 | client filtering | `price-range.spec.ts` |
| FR-PRC-007 | `nuqs` URL state | `price-range.spec.ts` |
| FR-PRC-008 | basis toggle | `price-range.spec.ts` |
| FR-PRC-009 | `/more` route, `tldsInBand` | `tlds-in-band.test.ts`, `find-more.spec.ts` |
| FR-PRC-010 | `fx_rates` (all currencies), `<CurrencySelect>`, locale default | `currency.spec.ts` |
| FR-PRC-011 | `jobs/refresh-prices`, status indicator | `refresh-prices.int.test.ts` |
| FR-PRC-012 | premium providers, `premiumPossible` | `price-for.test.ts` |
| FR-PRC-013 | `AftermarketProvider` (phase 3), `showPremiumSection` | `section-visibility.test.ts`, `aftermarket-adapter.test.ts` (when added) |
| FR-PRC-014 | `tld_policies` warnings | `price-for.test.ts`, `results.spec.ts` |
| FR-PRC-015 | renewWarning | `price-for.test.ts` |
| FR-PRC-016 | unpriced list | `price-for.test.ts`, `results.spec.ts` |
| FR-PRC-017 | `buyUrl` | `porkbun-adapter.test.ts` |
| FR-PRC-018 | filter includes free at min 0 | `price-range.spec.ts` |
| NFR-PRC-001 | memoized filtering | `price-range.perf.test.ts` |
| NFR-PRC-002 | stale warning | `status.spec.ts` |
| NFR-PRC-003 | Radix slider + aria-valuetext | axe in `price-range.spec.ts` |
| NFR-PRC-004 | refresh validation | `refresh-prices.int.test.ts` |

## 14. Risks and research links
- R-04 Porkbun pricing format/ToS; R-05 premium adapters; R-06 aftermarket; R-13 TLD policies (min years, restrictions).
- Risk: single price source → optional extra PriceProviders (any registrar with a free public price list).
