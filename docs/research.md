# Open Research Items

| Field | Value |
|---|---|
| Status | Approved (2026-10-03) |
| Last updated | 2026-10-03 |

These are facts we could not fully confirm while writing the specs. Each one must be resolved (verified, or a
decision recorded) before the features that depend on it are implemented. Every item lists a **fallback** so that
an unfavorable answer never blocks the project.

Status values: **Open** · **In progress** · **Resolved** (with date and outcome).

| ID | Question | Why it matters | How to verify | Fallback if the answer is "no" | Affects | Status |
|---|---|---|---|---|---|---|
| R-01 | Jev details: max questions per request; allowed characters in option keys; exact shape of `score` probabilities; data retention and training policy of TypeSafe and of Vercel AI Gateway | Batching (≤ 50 assumed), schema, privacy policy text | Official TypeSafe API reference + a live test with 60/100/200 questions; read both providers' data policies | Keep ≤ 50 questions/request; index-style keys (`o000`); accept both probability shapes; disclose retention as stated by providers | 002, 003, 008, 013 | Open |
| R-02 | Does ranking by `choice` probabilities over 250-name shards work as well as per-name `score` questions? | Ranking quality vs tokens | Golden-set experiment: NDCG@10 and tokens for both approaches | Use per-name `score` in batches for round 1 (≈ +10k tokens/search, still inside budget at lower volume) | 008 | Open |
| R-03 | RDAP rate limits of major registries (Verisign .com/.net, PIR .org, Identity Digital, Google Registry, CentralNic, Radix) and which ccTLDs lack RDAP; fair-use limits of Cloudflare/Google DoH | Politeness, accuracy, speed | Registry documentation, IANA bootstrap file, controlled load test at ≤ 5 req/s | Lower per-host rates; rely more on cache; mark "likely available" for TLDs without RDAP | 005 | Open |
| R-04 | Porkbun public pricing endpoint: stable format, allowed use for displaying prices, attribution requirements | Main price source | Read Porkbun API terms; contact support if unclear | Another registrar's public price list; or manual monthly price table for top 100 TLDs | 006, 010 | Open |
| R-05 | Premium-price detection: Porkbun `checkDomain` (1/10 s), Name.com and Dynadot APIs — free access, rate limits, terms for showing results | Accurate $101–300 and $300+ sections | Create free accounts; read terms; test batch sizes | Show "Premium price possible — confirm at registrar" (spec 006 FR-PRC-012) | 005, 006 | Open — owner chose these registrars as extra price sources too (2026-10-03); verify free price-list access as well |
| R-06 | A permitted, free source of aftermarket (resale) listings for the $300+ section (e.g. Sedo partner API) | Depth of Premium section | Apply to partner programs; read terms | $300+ section shows registry-premium names and expensive-extension registrations only, with an explanation | 006 | Open |
| R-07 | whoisds free newly-registered-domains list: allowed automated daily download, URL format, file format | Daily invalidation and trends | Read site terms; contact provider; test download | Skip NRD invalidation (TTLs + live re-checks still protect accuracy); later consider ICANN CZDS zone files (free, approval per TLD) | 005, 010 | Open |
| R-08 | Free providers (is-a.dev, js.org, eu.org, pp.ua, DigitalPlat, platform subdomains): current status, eligibility, terms on automated checks, permitted check methods | Free section correctness | Visit each provider, read rules, test methods | Mark provider `check_method = none` ("not verifiable") or remove it | 007 | Open |
| R-09 | Current free-plan limits: Vercel Hobby (function duration with streaming, invocations, AI Gateway credit), Supabase Free (size, pause, backups, auth e-mail limits), Upstash, Resend (sending-domain requirement), Brevo, Sentry, UptimeRobot, GitHub Actions, Turnstile, Frankfurter | Staying at $0 | Pricing pages and docs, recorded with date | Adjust caps; swap provider per spec 017 alternatives | 000, 001, 010–017 | Open — also verify Supabase anonymous sign-ins (MAU counting, Turnstile, manual identity linking) for spec 011 |
| R-10 | Are affiliate links allowed on Vercel Hobby (non-commercial) plan? | Possible future funding | Vercel fair-use / terms | No affiliate links while on Hobby (current decision in constitution P7) | 006, 017 | Open |
| R-11 | Datamuse API terms and limits; licenses of word lists (WordNet, ENABLE, profanity list, word-frequency list) | Name generation data | Read Datamuse page and each license | Use only public-domain/permissive lists; reduce Datamuse usage to cache + offline data | 004 | In progress (2026-10-03): offline data uses only ENABLE (public domain), WordNet 3.1 (WordNet licence) and LDNOOBW (CC BY 4.0) — see `packages/core/src/generation/data/NOTICE.md`. The "popular words" list from dolph/dictionary was not used (no licence; derived from CC BY-SA Wiktionary lists). Datamuse terms still to confirm. |
| R-12 | Tranco list license/terms for use in a public product (brand protection) | Brand look-alike blocking | Read Tranco terms; contact authors if needed | Curated brand seed list (manual, top ~2,000 brands) + Jev `risk_brand` | 004, 010, 014 | Open |
| R-13 | Eligibility rules and minimum registration years for the ~150 most relevant extensions (e.g. .us nexus, .eu residency, .ai 2-year minimum, .dev/.app HTTPS) | Honest warnings and upfront prices | Registry policy pages; registrar TLD pages | Mark unknown policies as "check registrar rules" and exclude clearly restricted ones | 003, 006 | Open |
| R-14 | External datasets suggested by the owner (2026-10-03): Maikobi/domain-generation-dataset, bedead/website-industry-13m, NeousAxis/aya-business-dataset — licence and usefulness | More test material; better word lists | Read each dataset card; sample rows | Do not use a dataset whose licence is unclear or whose quality cannot be shown | 004, 016 | Resolved 2026-10-03: **Maikobi** (Apache-2.0) used for an automatic smoke-test pool only — its descriptions, 15 harmful and 90 edge cases, credited; its AI-written names are long and generic, so they are *not* used as quality labels. **website-industry-13m** skipped: card says CC BY-SA but also "research and educational use only, no commercial use". **AYA** (CC BY 4.0) skipped for now: 0 of 100 sampled rows had a description, sector labels looked wrong, keywords are page boilerplate, uploaded 2026-10-01 so quality is unproven. |

## Sources consulted while writing the specs (2026-09-29)
- Jev API key and request basics — https://flaviocopes.com/jev-api-key/
- Jev question types and response fields — https://daleseo.com/jev/
- Jev limits, latency, pricing — https://www.cometapi.com/en/models/typesafe-ai/jev
- Jev via AI gateways — https://www.truefoundry.com/docs/ai-gateway/jev , https://www.netlify.com/changelog/typesafe-jev-ai-gateway/
- Vercel AI Gateway free credit — https://vercel.com/docs/ai-gateway/pricing
- Porkbun API v3 (pricing endpoint without auth; checkDomain rate limit) — https://porkbun.com/api/json/v3/documentation
- Newly registered domains (free daily list) — https://whoisds.com/newly-registered-domains , https://isc.sans.edu/diary/23127
- RDAP bulk checking examples — https://github.com/mpge/DomainGen
- Free domain options after Freenom — https://github.com/harys722/free-domains
