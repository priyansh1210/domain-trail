# Jev Question Catalog (v1)

| Field | Value |
|---|---|
| Status | Approved (2026-10-03) |
| Mirrors | `packages/jev/catalog/*.ts` (kept in sync by `catalog-sync.test.ts`) |
| Model | `jev-1.13.0` (pinned) |
| Last updated | 2026-09-29 |

**Rules**
- Question id format: `snake_case`; referenced as `id@version` (e.g. `site_type@1`).
- Any change to instructions or criteria ⇒ new version; old versions stay in code until no stored result uses them.
- Option keys use `[a-z0-9_]` only. Option values are the human-readable descriptions Jev reads.
- `{placeholders}` are filled at runtime. Per-candidate questions are sent as `id__n` (e.g. `rank_fit__12`).

## Overview

| Stage | Request(s) | Questions | Spec |
|---|---|---|---|
| S1 Safety + features | 2 parallel | 4 safety + 8 profile + 40 feature flags = 52 | 003, 014 |
| S2 Keywords | 1 | `keyword_core`, `expansion_fit` | 004 |
| S5 Ranking round 1 | 1–2 | `rank_shard` × up to 4 shards | 008 |
| S6 Ranking round 2 | 3 parallel | `rank_fit`, `risk_brand`, `risk_negative` × 45 + `tld_fit` | 008 |

State shapes:
- **S1/S2 state:** `{ "description": string, "preferences": { country?, preferredTlds?, nameStyle? } }`
- **S5/S6 state:** `{ "description": string, "summary": { siteType, industry, audience, geo, tone, features: string[] }, "keywords": string[] }`

---

## S1 — Safety (group `safety`)

| Id@v | Type | Instructions | Threshold / use |
|---|---|---|---|
| `safety_phishing@1` | noul | The website described is intended to trick people into giving passwords, payment details or personal data, or to pretend to be another organization. | ≥ 0.80 ⇒ refuse search |
| `safety_illegal@1` | noul | The website described is mainly for clearly illegal activity, such as selling illegal drugs or weapons, fraud, counterfeit goods or exploiting children. | ≥ 0.80 ⇒ refuse search |
| `safety_impersonation@1` | noul | The description asks for names that copy or imitate an existing well-known brand, company, product or public figure. | ≥ 0.70 ⇒ strict lookalike mode (spec 014) |
| `safety_adult@1` | noul | The website described is mainly adult or sexual content. | ≥ 0.70 ⇒ flag; no refusal (open question in spec 014) |

## S1 — Site profile (group `features`)

### `site_type@1` — choice
Instructions: *What kind of website is described?*

| Key | Description |
|---|---|
| `online_store` | Online store selling products |
| `saas_web_app` | Software or web application (SaaS) |
| `mobile_app` | Website promoting a mobile app |
| `blog` | Blog or personal writing |
| `news_media` | News, magazine or media publication |
| `portfolio` | Portfolio showing someone's work |
| `personal_site` | Personal homepage or CV |
| `agency_services` | Agency, consultancy or freelance services |
| `local_business` | Local business serving a city or area |
| `restaurant_cafe` | Restaurant, café, bakery or food service |
| `nonprofit` | Non-profit, charity or cause |
| `education_courses` | Courses, tutoring or education |
| `community_forum` | Community, forum or membership group |
| `marketplace` | Marketplace connecting buyers and sellers |
| `directory_listings` | Directory, listings or reviews site |
| `event` | Event, conference or festival |
| `startup_landing` | Startup or product landing page |
| `docs_open_source` | Documentation or open-source project |
| `podcast_video` | Podcast, video channel or creator |
| `booking_service` | Appointment or reservation service |
| `real_estate` | Real estate agency or property listings |
| `healthcare_practice` | Clinic, doctor, therapist or wellness practice |
| `professional_practice` | Law, accounting or other professional firm |
| `job_board` | Jobs or recruiting |
| `game` | Game or gaming site |
| `other` | Something else |

### `industry@1` — choice
Instructions: *Which industry or topic does this website belong to?*
Options: the industry taxonomy (≤ 200 keys) defined in [spec 003 tech §5.1](../../003-website-feature-detection/tech.md) and
seeded from `supabase/seed/taxonomy.json`.

### `audience@1` — choice
Instructions: *Who is the main audience of this website?*

| Key | Description |
|---|---|
| `consumers_general` | General consumers |
| `young_adults` | Teens and young adults |
| `families_kids` | Parents, families and children |
| `seniors` | Older adults |
| `students` | Students and learners |
| `professionals` | Working professionals |
| `small_businesses` | Small businesses and shop owners |
| `enterprises` | Large companies |
| `developers` | Software developers and technical users |
| `creators` | Artists, writers and content creators |
| `local_community` | People in one local area |
| `investors` | Investors and finance-minded users |
| `patients` | Patients and people seeking care |
| `travelers` | Travelers and tourists |
| `gamers` | Gamers |
| `donors_volunteers` | Donors and volunteers |
| `other` | Other audience |

### `geo_scope@1` — choice
Instructions: *Which country or region does this website mainly serve?*

Keys: `global`; regions `region_europe`, `region_asia`, `region_latam`, `region_africa`, `region_middle_east`;
countries `country_<iso2>` for: in, us, gb, ca, au, nz, ie, de, fr, es, it, nl, be, ch, at, se, no, dk, fi, pl, pt,
gr, cz, ro, hu, tr, ua, br, mx, ar, co, cl, pe, za, ng, ke, eg, ma, ae, sa, il, pk, bd, lk, np, sg, my, id, ph, th,
vn, jp, kr, cn, hk, tw; and `other_country`. Descriptions are the country/region names (e.g. `country_in` → "India").
Mapping to ccTLDs lives in spec 003 tech §5.3.

### `language@1` — choice
Instructions: *In which language will the website mainly be written?*
Keys: `en, hi, bn, ta, te, mr, es, pt, fr, de, it, nl, ru, ar, tr, ja, ko, zh, id, vi, th, pl, other`
(descriptions are language names in English).

### `name_style@1` — choice
Instructions: *Which naming style would suit this website best, given its type, audience and tone?*

| Key | Description |
|---|---|
| `descriptive` | Says clearly what it does (e.g. "freshbreaddelivery") |
| `compound` | Two real words combined (e.g. "sunnycrust") |
| `brandable` | Short invented word that is easy to say (e.g. "zapora") |
| `personal_name` | Based on a person's name |
| `playful` | Fun, witty or pun-based |
| `short_premium` | Very short (3–6 letters), premium-sounding |

### `tone@1` — score
Instructions: *What tone should the website's name have?*
Criteria (low → high): `["Very playful and fun", "Friendly and casual", "Neutral", "Professional", "Very formal and serious"]`

### `clarity@1` — score
Instructions: *How clearly does the description explain what the website offers and for whom?*
Criteria: `["Too vague to know what the website does", "General idea, but missing what it offers or who it is for", "Clear offering and audience", "Very specific: offering, audience and place or style"]`
Use: score < 1.0 ⇒ ask the user for more detail before generating (spec 001).

## S1 — Feature flags (group `features`, all `noul`, version 1)
Instructions pattern: *The website described …* (text below). A flag is "on" when `noul ≥ 0.60`
(threshold in config; tuned on the golden set).

| Id | Statement ("The website described …") |
|---|---|
| `feat_sells_physical` | sells physical products online. |
| `feat_sells_digital` | sells digital products such as downloads, templates or e-books. |
| `feat_subscription` | charges a recurring subscription. |
| `feat_software` | is a software product or web application. |
| `feat_mobile_app` | mainly promotes a mobile app. |
| `feat_developer` | is aimed at software developers or technical users. |
| `feat_ai` | is built around artificial intelligence. |
| `feat_bookings` | lets people book appointments, tables or reservations. |
| `feat_local` | serves customers in a specific city or local area in person. |
| `feat_food` | is about food, drinks, cooking or restaurants. |
| `feat_articles` | regularly publishes articles, news or blog posts. |
| `feat_media` | publishes videos or podcasts. |
| `feat_courses` | teaches through courses, lessons or tutoring. |
| `feat_community` | lets members talk to each other or join a community. |
| `feat_marketplace` | connects many sellers or providers with buyers. |
| `feat_portfolio` | shows the work of a person or studio. |
| `feat_personal` | is about one individual person. |
| `feat_nonprofit` | belongs to a non-profit, charity or cause. |
| `feat_donations` | asks visitors for donations. |
| `feat_events` | promotes or sells tickets to events. |
| `feat_jobs` | lists jobs or helps with hiring. |
| `feat_real_estate` | lists properties for sale or rent. |
| `feat_travel` | is about travel, tourism or accommodation. |
| `feat_health` | offers health, medical or wellness services. |
| `feat_finance` | offers financial, payment or investment services. |
| `feat_legal` | offers legal services. |
| `feat_school` | belongs to a school, college or educational institution. |
| `feat_kids` | is designed for children or families. |
| `feat_gaming` | is about video games or gaming. |
| `feat_crypto` | is about cryptocurrency, blockchain or web3. |
| `feat_b2b` | mainly sells to other businesses. |
| `feat_agency` | offers agency, consulting or freelance services. |
| `feat_directory` | is a directory, listings or reviews site. |
| `feat_docs` | hosts documentation or an open-source project. |
| `feat_multilingual` | serves several countries or languages. |
| `feat_luxury` | has a premium or luxury brand image. |
| `feat_eco` | focuses on sustainability or the environment. |
| `feat_fitness` | is about fitness, sports or outdoor activities. |
| `feat_fashion_beauty` | is about fashion, clothing or beauty. |
| `feat_pets` | is about pets or animals. |

---

## S2 — Keywords (group `keywords`)

### `keyword_core@1` — choice
Instructions: *Which word or phrase best describes the core product, service or topic of this website?*
Criteria: built at runtime from extracted terms (≤ 60): keys `t00`…`t59`, values = the term (e.g. `t03` → "sourdough bread").
Use: probabilities become keyword weights (spec 004 §5.2).

### `expansion_fit@1` — choice
Instructions: *Which of these words would fit most naturally into a name for this website?*
Criteria: built at runtime from related words (≤ 255): keys `w000`…`w254`, values = the word.
Use: top-N by probability (default 40) are kept for generation.

---

## S5 — Ranking round 1 (group `rank_r1`)

### `rank_shard@1` — choice (sent up to 4 times: `rank_shard__0` … `rank_shard__3`)
Instructions: *Which of these would make the best domain name (without the extension) for the website described?
Prefer names that are relevant, memorable, easy to spell and say, and match the tone.*
Criteria: keys `o000`…`o249`, values = candidate label (e.g. `o017` → "sunnycrust").
Use: top 15 per shard by probability → ≤ 60 go to round 2 (then trimmed to 45 by deterministic score, spec 008).

## S6 — Ranking round 2 (groups `rank_r2`, `tld_fit`)

### `rank_fit@1` — score (per candidate: `rank_fit__n`)
Instructions: *How well does the name "{label}" fit the website described, as its domain name?*
Criteria: `["Unrelated or confusing", "Weak fit", "Acceptable but generic", "Good fit", "Excellent: relevant, memorable and on-tone"]`

### `risk_brand@1` — noul (per candidate: `risk_brand__n`)
Instructions: *The name "{label}" contains, imitates or could easily be confused with an existing well-known brand, company, product or trademark.*
Use: ≥ 0.50 ⇒ exclude candidate.

### `risk_negative@1` — noul (per candidate: `risk_negative__n`)
Instructions: *The name "{label}" has an offensive, negative, embarrassing or unintended meaning, including when its words run together.*
Use: ≥ 0.60 ⇒ exclude candidate.

### `tld_fit@1` — choice
Instructions: *Which domain extension would suit this website best?*
Criteria: built at runtime from the TLD pool (≤ 80, spec 003 tech §5.3): keys `tld_<name>` (dots removed, e.g. `tld_com`, `tld_co_in`),
values = short description from `tld_policies` (e.g. `tld_shop` → ".shop — for online stores").
Use: probabilities become TLD-fit weights (spec 008 §5.4).

---

## Change log

| Date | Change |
|---|---|
| 2026-09-29 | v1 catalog drafted |
