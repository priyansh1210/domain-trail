# Tech 003 — Website Feature Detection

| Field | Value |
|---|---|
| Implements | [spec.md](./spec.md) |
| Status | Approved (2026-10-03) |
| Owning packages | `packages/core/features`, `packages/jev/catalog/features.ts`, `supabase/seed/taxonomy.json` |
| Last updated | 2026-10-03 |

## 1. Components and diagram

```
pipeline S1
  buildState('S1', {description, preferences})
      │
      ├── DecisionService.ask(group=safety+features)   → 2 parallel Jev requests (26 questions each)
      │         └─ on failure → fallback/featuresRules()
      ▼
  interpretFeatures(answers) → SiteProfile
      ├─ apply thresholds (config)
      ├─ apply user overrides (preferences.country, chip edits)
      ├─ derive: sensitiveCategories, tldPool (§5.3), keywordHints (§5.4)
      ▼
  SSE event `features` → UI chips (spec 009)
```

## 2. Stack and libraries
TypeScript only; taxonomy and mapping tables are JSON seeds validated by zod at build time.

## 3. Data model

```ts
export interface Detected<T> { value: T; confidence: number; alternatives: Array<{ value: T; p: number }>; edited: boolean }

export interface SiteProfile {
  siteType: Detected<SiteType>;
  industry: Detected<IndustryKey>;
  audience: Detected<AudienceKey>;
  geo: Detected<GeoKey>;                  // 'global' | 'region_*' | 'country_xx' | 'other_country'
  language: Detected<LangKey>;
  tone: { score: number; level: 0|1|2|3|4; confidence: number; edited: boolean };
  nameStyle: Detected<NameStyle>;
  clarity: { score: number; tooVague: boolean };
  flags: Record<FeatureFlag, { p: number; on: boolean; edited: boolean }>;
  sensitive: Array<'adult'|'gambling'|'crypto'|'health'|'finance'>;
  source: 'jev' | 'rules';
  catalogVersions: Record<string, number>;   // e.g. { site_type: 1, industry: 1, ... }
}
```

Persisted as `searches.features jsonb` (spec 012). No description text inside.

## 4. Interfaces
- `detectFeatures(ctx): Promise<SiteProfile>` — S1.
- `applyEdits(profile, edits: FeatureEdits): SiteProfile` — used by `POST /api/search/{id}/refine` (spec 009), which
  re-runs S2–S9 with the edited profile and **skips S1** (FR-FEAT-011). `/refine` requires a signed-in,
  non-anonymous session (`is_anonymous = false`); otherwise it returns 401 and the UI shows the chips read-only with
  a "Sign in to edit" button (owner decision 2026-10-03).
- `buildTldPool(profile, prefs, tldsTable): TldKey[]` (§5.3).

## 5. Algorithms and logic

### 5.1 Industry taxonomy (seed `taxonomy.json`, 141 entries in v1, ≤ 200 allowed)
Keys are `group__item`. Groups and items:

| Group | Items |
|---|---|
| `food` | bakery, restaurant, cafe_coffee, catering, food_delivery, grocery, recipes_cooking, beverages, organic_health_food, sweets_confectionery |
| `retail` | fashion_clothing, jewelry, shoes, beauty_cosmetics, home_decor, furniture, electronics, books, toys, gifts, handmade_crafts, sporting_goods, pet_supplies, general_store |
| `tech` | saas_b2b, developer_tools, ai_ml, mobile_apps, cybersecurity, data_analytics, cloud_hosting, web_design_dev, it_services, hardware_iot, open_source |
| `finance` | banking_fintech, investing, insurance, accounting_tax, crypto_web3, personal_finance, payments, lending |
| `health` | clinic_doctor, dental, mental_health_therapy, fitness_gym, yoga_meditation, nutrition_diet, pharmacy, ayurveda_alternative, elder_care, veterinary |
| `education` | school, coaching_tutoring, online_courses, test_prep, language_learning, kids_learning, university, skills_training |
| `services` | legal, consulting, marketing_agency, design_studio, photography, video_production, cleaning, repair_maintenance, logistics_courier, recruitment_hr, event_planning, wedding_services, printing, translation |
| `real_estate` | property_listings, real_estate_agency, construction, interior_design, architecture, coworking_rentals |
| `travel` | travel_agency, hotel_homestay, tours_experiences, transport_rental, travel_blog |
| `media` | news, magazine, blog_personal, podcast, video_channel, music, film, photography_art, writing_publishing |
| `community` | forum, club_association, religious_spiritual, alumni, local_community, fan_community |
| `nonprofit` | charity, ngo_development, environment, animal_welfare, education_charity, health_charity |
| `lifestyle` | parenting, relationships_dating, home_garden, diy, hobbies, fashion_blog, beauty_blog, luxury |
| `automotive` | car_dealer, auto_repair, ev_mobility, bikes_motorcycles |
| `entertainment` | gaming, esports, comedy, events_nightlife, movies_tv |
| `agriculture` | farming, agritech, dairy, plants_nursery |
| `industry` | manufacturing, energy_solar, chemicals, textiles, import_export, wholesale |
| `government_public` | civic_services, political_campaign |
| `personal` | portfolio_cv, personal_brand, wedding_site, family_site |
| `other` | other |

Each entry has: `label` (UI text), `keywords` (fallback matching), `wordHints` (seed words for generation, spec 004),
`tldHints` (extra TLDs for §5.3).

### 5.2 Thresholds (config)

| Name | Default | Meaning |
|---|---|---|
| `FEAT_FLAG_ON` | 0.60 | flag present |
| `FEAT_UNSURE_CONFIDENCE` | 0.55 | chip marked "unsure" when `confidence` (choice) < this |
| `FEAT_ALTERNATIVES_MIN_P` | 0.10 | alternatives shown on chip if p ≥ this (max 3) |
| `CLARITY_VAGUE_BELOW` | 1.0 | clarity score below ⇒ `needs_detail` |

### 5.3 TLD pool builder (≤ 80 TLDs, input to `tld_fit@1`)
```
pool = ordered set
add ['com','net','co','org','io','app','xyz','online','site']        # base
add prefs.preferredTlds                                               # user first
geo = override(prefs.country) ?? profile.geo
add GEO_TLDS[geo]                     # e.g. country_in → ['in','co.in'], country_gb → ['uk','co.uk'], region_europe → ['eu']
for flag in flags sorted by p desc where on: add FLAG_TLDS[flag]
add INDUSTRY.tldHints[profile.industry]
remove TLDs where tld_policies.restricted = 'blocked_for_public' or tld not in tlds_with_price
if sensitive has 'adult' → keep; else remove adult-only TLDs (e.g. .xxx, .adult, .sex, .porn)
truncate to 80
```

`FLAG_TLDS` (seed `flag_tlds.json`, excerpt):

| Flag | TLDs |
|---|---|
| `feat_sells_physical` | shop, store, market, boutique |
| `feat_sells_digital` | shop, store, digital |
| `feat_software` | io, app, so, tech, cloud, software |
| `feat_mobile_app` | app |
| `feat_developer` | dev, io, sh, tools, codes |
| `feat_ai` | ai, io, tech |
| `feat_food` | cafe, kitchen, menu, recipes, restaurant, pizza, coffee |
| `feat_articles` | blog, news, press, media |
| `feat_media` | tv, fm, media, studio, show |
| `feat_courses` | academy, courses, school, education, training |
| `feat_community` | community, club, social, org |
| `feat_marketplace` | market, shop, store, exchange |
| `feat_portfolio` | design, studio, me, art, gallery, work |
| `feat_personal` | me, name, page, bio |
| `feat_nonprofit` / `feat_donations` | org, ngo, foundation, charity, fund |
| `feat_events` | events, live |
| `feat_jobs` | careers, work |
| `feat_real_estate` | homes, house, properties, estate |
| `feat_travel` | tours, holiday, voyage, travel |
| `feat_health` | health, care, clinic, doctor |
| `feat_finance` | finance, money, capital, fund |
| `feat_legal` | legal, attorney, lawyer |
| `feat_school` | school, academy, education, college |
| `feat_kids` | family, fun, toys |
| `feat_gaming` | gg, games, game, fun |
| `feat_crypto` | xyz, finance |
| `feat_b2b` / `feat_agency` | agency, solutions, services, company, consulting, digital |
| `feat_directory` | directory, guide, reviews, info |
| `feat_docs` | dev, page, wiki, sh |
| `feat_multilingual` | global, world |
| `feat_luxury` | luxury, boutique, vip |
| `feat_eco` | eco, earth, green |
| `feat_fitness` | fit, fitness, run, yoga, coach |
| `feat_fashion_beauty` | fashion, style, boutique, beauty |
| `feat_pets` | pet, pets, dog, vet |
| `feat_local` | GEO_TLDS[geo] promoted to the front |

`GEO_TLDS` covers every `country_*` key of the catalog (seed `geo_tlds.json`); eligibility rules are enforced by
`tld_policies` (spec 006) and shown as warnings, not silently removed, unless `blocked_for_public`.

### 5.4 Keyword hints for generation (spec 004)
`keywordHints = industry.wordHints ∪ FLAG_WORDS[on flags] ∪ geo words (city/country names detected in text)`.
Example: `feat_bookings` → ["book", "slot", "reserve"]; `feat_local` → detected city name ("pune").

### 5.5 Rule-based fallback (`fallback/featuresRules.ts`)
- Tokenize + lemmatize with wink-nlp.
- `siteType`, `industry`: highest weighted keyword overlap with taxonomy `keywords` (ties → `other`), confidence = 0.4.
- `geo`: gazetteer of countries + top 500 cities (seed `gazetteer.json`) → country; else `global`.
- `language`: script detection (Devanagari → hi, etc.) else `en`.
- `tone`: 2 (neutral); `nameStyle`: `compound`.
- flags: keyword lists per flag (seed `flag_keywords.json`), p = 0.7 if matched else 0.1.
- `clarity`: word count < 6 → 0.5 (vague), else 2.0.
- `source = 'rules'`.

### 5.6 Sensitive categories (FR-FEAT-015)
`adult` ← `safety_adult` ≥ 0.70; `gambling` ← industry/keywords; `crypto` ← `feat_crypto`; `health` ← `feat_health`;
`finance` ← `feat_finance`. Effects: extension filtering (§5.3), stricter brand rules for finance/crypto (spec 014).

## 6. External services and free-tier limits
Jev only (spec 002). No other external calls in S1.

## 7. Configuration and secrets
Thresholds in §5.2 via `packages/config`. Seeds under `supabase/seed/` and bundled into `packages/core` at build.

## 8. Errors, retries and fallbacks

| Failure | Response |
|---|---|
| One of the two S1 requests fails | Missing questions filled by §5.5 rules; `source` stays `jev` for others; per-field `source` recorded |
| Both fail / breaker open / budget | Full §5.5 fallback, `degraded` SSE event |
| Unknown option key | Field from rules |

## 9. Security and privacy controls
Only description + preferences in state (spec 002 `buildState`). Safety answers are evaluated here but acted on by spec 014.

## 10. Performance and cost budgets
S1: 2 parallel requests, ~5,000 tokens, deadline 4 s. `interpretFeatures` + TLD pool < 5 ms.

## 11. Test plan

| Test | Type | What it proves |
|---|---|---|
| `interpret-features.test.ts` | unit | thresholds, unsure marking, alternatives, overrides |
| `tld-pool.test.ts` | unit | order, cap 80, geo, flags, adult filtering, blocked removal |
| `apply-edits.test.ts` | unit | edits override values, S1 not re-run |
| `features-rules.test.ts` | unit | fallback on 30 sample descriptions (≥ 60% site type) |
| `taxonomy-seed.test.ts` | unit | ≤ 200 industries, unique keys, every flag has TLD/word entries |
| weekly eval (spec 002) | eval | NFR-FEAT-002…005 |
| `features-chips.spec.ts` | e2e | chips visible before names; edit chip → refreshed results |

## 12. Observability
Metrics: detection source mix (jev/rules), unsure-chip rate, chip-edit rate by field (drives taxonomy improvements).

## 13. Traceability matrix

| Requirement | Component(s) | Test(s) |
|---|---|---|
| FR-FEAT-001 | `site_type@1`, `interpretFeatures` | `interpret-features.test.ts`, eval |
| FR-FEAT-002 | `industry@1`, taxonomy seed | `taxonomy-seed.test.ts`, eval |
| FR-FEAT-003 | `audience@1` | `interpret-features.test.ts` |
| FR-FEAT-004 | `geo_scope@1`, gazetteer | `interpret-features.test.ts`, eval |
| FR-FEAT-005 | `language@1` | `interpret-features.test.ts` |
| FR-FEAT-006 | `tone@1` | `interpret-features.test.ts` |
| FR-FEAT-007 | `name_style@1` | `interpret-features.test.ts` |
| FR-FEAT-008 | `feat_*@1`, `FEAT_FLAG_ON` | `interpret-features.test.ts`, eval |
| FR-FEAT-009 | `clarity@1`, `needs_detail` event | `interpret-features.test.ts`, `intake.spec.ts` |
| FR-FEAT-010 | `features` SSE event, `<FeatureChips>` | `features-chips.spec.ts` |
| FR-FEAT-011 | `applyEdits`, `/refine` route (signed-in only), read-only chips when signed out | `apply-edits.test.ts`, `refine-auth.test.ts`, `features-chips.spec.ts` |
| FR-FEAT-012 | overrides in `interpretFeatures` | `interpret-features.test.ts` |
| FR-FEAT-013 | `buildTldPool`, `keywordHints`, reason templates (spec 008) | `tld-pool.test.ts`, `reasons.test.ts` |
| FR-FEAT-014 | `featuresRules` | `features-rules.test.ts` |
| FR-FEAT-015 | §5.6 | `interpret-features.test.ts` |
| NFR-FEAT-001 | S1 deadline | `pipeline.perf.test.ts` |
| NFR-FEAT-002 | `site_type@1` | weekly eval report |
| NFR-FEAT-003 | `industry@1` + taxonomy | weekly eval report |
| NFR-FEAT-004 | `geo_scope@1` + gazetteer | weekly eval report |
| NFR-FEAT-005 | `feat_*@1` + `FEAT_FLAG_ON` | weekly eval report |
| NFR-FEAT-006 | rules fallback | `features-rules.test.ts` |

## 14. Risks and research links
- R-13: TLD eligibility policies for country and restricted TLDs must be curated and verified.
- Risk: industry list may miss niches → chip-edit metrics feed taxonomy updates (new catalog version).
