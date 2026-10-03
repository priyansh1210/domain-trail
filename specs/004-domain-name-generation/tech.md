# Tech 004 — Domain Name Generation

| Field | Value |
|---|---|
| Implements | [spec.md](./spec.md) |
| Status | Approved (2026-10-03) |
| Owning packages | `packages/core/generate`, `packages/core/words`, `packages/core/quality` |
| Last updated | 2026-10-03 |

## 1. Components and diagram

```
S2 keywords                                    S3 generate                       S4 prefilter
┌───────────────────────────┐   terms+weights  ┌─────────────────────────┐ raw   ┌──────────────────────────┐
│ extractTerms (wink-nlp)   │─────────────────▶│ strategies/* (12)       │──────▶│ validateLDH              │
│ Jev keyword_core@1        │   expansions      │ seeded PRNG (cache key) │ ≤2000 │ prefs filter             │
│ relatedWords (Datamuse +  │─────────────────▶│ per-strategy caps       │       │ profanity + brand filter │
│   word_cache + offline)   │                   └─────────────────────────┘       │ quality score Q          │
│ Jev expansion_fit@1       │                                                     │ dedup / near-dup merge   │
└───────────────────────────┘                                                     │ diversity cap (≤40%)     │
                                                                                  └──────────┬───────────────┘
                                                                                             ▼ ≤ 1,000 → S5
```

## 2. Stack and libraries

| Concern | Choice | License / notes |
|---|---|---|
| Tokenize, POS, noun phrases, lemmas | `wink-nlp` + `wink-eng-lite-web-model` | MIT |
| Related words (online) | Datamuse API | free, no key, ≤ 100k req/day (R-11) |
| Related words (offline) | WordNet 3.1 synonyms/hypernyms pre-extracted to `words/wordnet-min.json` (~2 MB gz) | WordNet License (permissive) — R-11 |
| Dictionary / segmentation | ENABLE word list (public domain) + frequency ranks from a permissively licensed list | R-11 |
| Profanity list | LDNOOBW English list + custom additions | CC-BY 4.0 — R-11 |
| Brand list | `brand_labels` from Tranco top sites (spec 010) + curated seed | R-12 |
| Transliteration | `transliteration` npm (Devanagari, etc. → Latin) | MIT |
| PRNG | `seedrandom`-style mulberry32 seeded by cache key | no dependency |

## 3. Data model
- `word_cache(term text, relation text, words jsonb, fetched_at timestamptz, primary key(term, relation))` — Datamuse
  responses cached 30 days (spec 012). One batched upsert per search.
- `keyword_trends(day date, token text, kind text, count int)` — read-only here (spec 010).
- Candidate (in memory, persisted only for the shown results):

```ts
export interface Candidate {
  label: string;                 // 'sunnycrust'
  strategy: Strategy;            // 'compound' | 'affix' | ...
  sourceTerms: string[];         // ['sunny', 'crust']
  quality: number;               // Q in [0,1]
  keywordCoverage: number;       // K in [0,1] (weight of core terms present)
  hackTld?: string;              // for domain hacks: label + tld make a word
  flags: { hasDigit: boolean; hasHyphen: boolean; realWords: number; segments: string[] };
}
```

## 4. Interfaces

```ts
extractTerms(desc: string, lang: LangKey): Term[]                       // ≤ 60 terms
weighTerms(terms, jevAnswer | null): WeightedTerm[]                     // Jev keyword_core@1 or TF fallback
relatedWords(terms: WeightedTerm[], ctx): Promise<Expansion[]>          // ≤ 255 → Jev expansion_fit@1 → top 40
generate(input: GenInput, rng: Rng, exclude: Set<string>): Candidate[]  // raw ≤ 2,000
prefilter(cands: Candidate[], prefs, lists): Candidate[]                // ≤ 1,000
```

## 5. Algorithms and logic

### 5.1 Term extraction (FR-GEN-001)
1. wink-nlp: sentences → tokens → POS; keep NOUN, PROPN, ADJ, VERB (lemmas); noun-phrases via simple chunker
   (ADJ* NOUN+).
2. Drop stopwords, generic words (`website`, `online`, `best`, `service`, `company`, `platform`, `app` — list in
   `words/generic.json`, still used by affix strategy), brand words (brand list), numbers.
3. Add `keywordHints` from spec 003 §5.4 (weight prior 0.3), city/country names if `feat_local`.
4. Romanize non-Latin terms (FR-GEN-017).
5. Keep ≤ 60 terms by frequency × POS weight (NOUN 1.0, PROPN 0.9, ADJ 0.6, VERB 0.5).

### 5.2 Term weighting (FR-GEN-002)
- Jev `keyword_core@1` (choice over terms) → `w_jev(t) = p(t)`.
- Fallback / blend: `w_tf(t)` = normalized frequency × POS weight.
- Final: `w(t) = 0.7·w_jev + 0.3·w_tf` (Jev available) else `w_tf`. Top 8 terms are "core terms".

### 5.3 Related words (FR-GEN-003, FR-GEN-018)
For each of the top 5 core terms (≤ 15 calls total):
- `GET https://api.datamuse.com/words?ml={term}&max=40` (means-like)
- `GET https://api.datamuse.com/words?rel_trg={term}&max=20` (triggers / associated)
- `GET https://api.datamuse.com/words?rel_jjb={term}&max=15` (adjectives often used with the noun)
Look up `word_cache` first; timeout 1.5 s per call; on failure use `wordnet-min.json`.
Filter: single words, 2–12 letters, in dictionary, not profane/brand → ≤ 255 → Jev `expansion_fit@1` → keep top 40
(fallback: top 40 by Datamuse score).

### 5.4 Strategies (FR-GEN-004, FR-GEN-005, FR-GEN-012, FR-GEN-013)
`C` = core terms (8), `E` = kept expansions (40), `A` = affix lists, `G` = geo words.

| Strategy | Rule | Cap | Example ("online sourdough bakery in Pune") |
|---|---|---|---|
| `exact` | each core term, and 2-term core phrases, spaces removed | 30 | sourdough, sourdoughbakery |
| `compound` | pairs from (C∪E)×(C∪E), ordered both ways, length ≤ max | 500 | crumbcraft, sunnycrust |
| `affix` | prefixes `get,try,my,the,go,hey,join,use,hello` + C; C + suffixes `hq,hub,lab,labs,co,ly,ify,io,app,now,club,house,works,studio` (trend-weighted, FR-GEN-016) | 300 | getsourdough, sourdoughhq |
| `blend` | portmanteau of two words where suffix of w1 overlaps prefix of w2 (≥ 2 chars) or vowel-boundary splice | 200 | breadelight |
| `short` | clipping (first syllables), vowel drop after first letter (bakery→bakry), `-r`/`-ly` endings | 100 | sourdo, bakry |
| `alliteration` | pairs from C∪E sharing first phoneme (simple letter-sound map) | 100 | bakebloom |
| `rhyme` | Datamuse `rel_rhy` for top 2 core terms, combined with a core term | 50 | doughgo |
| `brandable` | 2–3 syllable pseudo-words: char-level Markov (order 3) trained on ENABLE, seeded with core-term first syllables; accept if pronounceability ≥ 0.6 | 300 | loavia, crumbo |
| `hack` | label + TLD spells a core/expansion word; TLD must be in `tlds` with price | 50 | cak.es |
| `geo` | geo word + C, C + geo word (city, country, demonym) when `feat_local` or geo ≠ global | 150 | punebakes, sourdoughpune |
| `action` | verb list by site type (store→shop/buy/order; bookings→book; courses→learn; community→join) + C | 150 | ordersourdough |
| `personal` | proper names in description (PROPN person) + (C or role words `studio,design,writes`) | 50 | priyabakes |

Sampling within each strategy uses the seeded PRNG so output is deterministic (FR-GEN-014).
`exclude` set (labels already shown in this search) is removed before caps (FR-GEN-015).

### 5.5 Prefilter (FR-GEN-006…011)
```
for c in raw:
  c.label = lowercase ascii only
  reject unless /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/                   # LDH
  reject if label.length > prefs.maxLength
  reject if !prefs.allowHyphens && '-' in label   # allowHyphens: any number of hyphens (owner decision)
  reject if '--' in label                          # positions 3–4 are reserved for IDN (RFC 5891); ugly elsewhere
  reject if !prefs.allowDigits && /\d/
  reject if contains profanity (substring match on segmented words + raw with leet map)
  reject if brandRisk(label) (spec 014 §5.2: exact/contains/edit-distance ≤ 1 to top-10k brand labels)
  reject if /(.)\1\1/ (triple letters)
  c.quality = Q(c)       # §5.6
  reject if c.quality < 0.35
dedup: key = stem(segments).join('') (plural/singular, -er/-ers) → keep highest quality
diversity: sort by (0.5·quality + 0.5·keywordCoverage) desc; take ≤ 1,000 with per-strategy share ≤ 40%
```

### 5.6 Quality score Q (FR-GEN-008)
```
Q = 0.30·lengthScore + 0.30·pronounceability + 0.20·segmentation + 0.10·spellClarity + 0.10·cleanChars
lengthScore      = 1 for 5–10 chars, linear down to 0 at 3 and at 18
pronounceability = sigmoid of mean char-trigram log-prob (English model) normalized on ENABLE distribution
segmentation     = 1 if label splits into ≤ 2 dictionary words, 0.7 for 3, 0.4 brandable (0 words) with pron ≥ 0.7, else 0.2
spellClarity     = 1 − penalties (ambiguous homophones: 'ph' vs 'f', 'c/k', 'z/s' swaps, doubled letters at word joins, 'u'/'4'/'2' textisms)
cleanChars       = 1 − 0.5·hasHyphen − 0.5·hasDigit
keywordCoverage K= Σ w(t) for core terms t present in segments (capped at 1)
```

## 6. External services and free-tier limits

| Service | Used for | Free-tier limit | Source | Verified |
|---|---|---|---|---|
| Datamuse | related words | no key, up to 100,000 requests/day | datamuse.com/api | R-11 |
| Jev | term weights, expansion fit | spec 002 | — | — |

## 7. Configuration and secrets
No secrets. Config: strategy caps, affix lists, `QUALITY_MIN=0.35`, `MAX_CANDIDATES=1000`, `STRATEGY_MAX_SHARE=0.4`,
`DATAMUSE_TIMEOUT_MS=1500`, `DATAMUSE_MAX_CALLS=15`, `WORD_CACHE_TTL_DAYS=30`.

## 8. Errors, retries and fallbacks

| Failure | Response |
|---|---|
| Datamuse timeout / 5xx | no retry (latency matters); offline WordNet data |
| Jev keyword questions fail | TF weights, Datamuse ordering |
| < 100 candidates after prefilter | relax: raise max caps ×2 for `brandable`, `affix`, `short`; lower `QUALITY_MIN` to 0.25; flag `low_supply` |

## 9. Security and privacy controls
- Datamuse receives only single words (never the description).
- Brand/profanity filters run before anything is sent to ranking or shown.

## 10. Performance and cost budgets
Generation + prefilter < 300 ms p95 (pure CPU, arrays of ≤ 2,000 strings); Markov model loaded once per instance
(~1 MB); Datamuse calls in parallel with S1 (they depend only on S2 term extraction, which is local).

## 11. Test plan

| Test | Type | What it proves |
|---|---|---|
| `extract-terms.test.ts` | unit | nouns/phrases, generic/brand removal, romanization |
| `weigh-terms.test.ts` | unit | Jev blend + fallback |
| `related-words.test.ts` | unit + MSW | Datamuse, cache, offline fallback, call cap |
| `strategies/*.test.ts` | unit | each strategy's rule, caps, determinism with fixed seed |
| `prefilter.test.ts` | unit | LDH regex (property-based with fast-check), prefs, profanity, brand, dedup, diversity cap |
| `quality.test.ts` | unit | Q ordering sanity (e.g. "breadly" > "brdxq") |
| `determinism.test.ts` | unit | same input → identical output |
| `find-more.test.ts` | unit | exclude set respected |
| golden eval (spec 016) | eval | NFR-GEN-003 |

## 12. Observability
Per search: raw count per strategy, pass count, rejection reasons histogram, Datamuse latency & cache hit rate, `low_supply` rate.

## 13. Traceability matrix

| Requirement | Component(s) | Test(s) |
|---|---|---|
| FR-GEN-001 | `extractTerms` | `extract-terms.test.ts` |
| FR-GEN-002 | `weighTerms`, `keyword_core@1` | `weigh-terms.test.ts` |
| FR-GEN-003 | `relatedWords`, `expansion_fit@1` | `related-words.test.ts` |
| FR-GEN-004 | `strategies/*` | `strategies/*.test.ts` |
| FR-GEN-005 | `Candidate.strategy` | `strategies/*.test.ts` |
| FR-GEN-006 | LDH check in `prefilter` | `prefilter.test.ts` |
| FR-GEN-007 | prefs checks in `prefilter` | `prefilter.test.ts` |
| FR-GEN-008 | `quality.ts` | `quality.test.ts` |
| FR-GEN-009 | profanity + `brandRisk` | `prefilter.test.ts` |
| FR-GEN-010 | dedup | `prefilter.test.ts` |
| FR-GEN-011 | caps + diversity | `prefilter.test.ts` |
| FR-GEN-012 | `geo` strategy | `strategies/geo.test.ts` |
| FR-GEN-013 | `hack` strategy uses `tlds` with price | `strategies/hack.test.ts` |
| FR-GEN-014 | seeded PRNG | `determinism.test.ts` |
| FR-GEN-015 | `exclude` set | `find-more.test.ts` |
| FR-GEN-016 | trend-weighted affixes | `strategies/affix.test.ts` |
| FR-GEN-017 | transliteration | `extract-terms.test.ts` |
| FR-GEN-018 | offline WordNet fallback | `related-words.test.ts` |
| NFR-GEN-001 | CPU budget | `generate.perf.test.ts` |
| NFR-GEN-002 | `DATAMUSE_MAX_CALLS` | `related-words.test.ts` |
| NFR-GEN-003 | full pipeline | monthly eval (spec 016) |
| NFR-GEN-004 | filters | `prefilter.test.ts`, user reports (spec 009 feedback) |

## 14. Risks and research links
- R-11: Datamuse terms and word-list licenses.
- R-12: Tranco license for the brand list.
- Risk: Markov brandables can produce accidental real words in other languages → `risk_negative@1` (spec 008) catches most.
