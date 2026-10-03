# Tech 008 — Ranking and Recommendations

| Field | Value |
|---|---|
| Implements | [spec.md](./spec.md) |
| Status | Approved (2026-10-03) |
| Owning packages | `packages/core/rank`, `packages/core/reasons`, `jobs/tune-weights` |
| Last updated | 2026-10-03 |

## 1. Components and diagram

```
≤1,000 candidates (spec 004)
   │ S5 rankRound1()  ── Jev rank_shard@1 × ⌈N/250⌉ (1 request) ──▶ lift per candidate
   ▼ top 60 (15/shard + fill by deterministic)  → trim to 45
   │ S6 rankRound2()  ── Jev rank_fit@1, risk_brand@1, risk_negative@1 (×45) + tld_fit@1 (3 requests)
   ▼ exclusions (brand ≥ 0.5, negative ≥ 0.6)
   │ pair()           ── label × TLDs (fit top-6 ∪ preferred ∪ hack ∪ band TLDs) → 150–300 FQDNs
   ▼ S7 availability (spec 005) streaming results
   │ S8 price + tier (spec 006)
   │ S9 finalScore() → sections → diversity → reasons → SSE `batch`
```

## 2. Stack and libraries
TypeScript only. Weight tuning job uses a tiny logistic-regression implementation (no ML dependency) or `ml-logistic-regression` (MIT).

## 3. Data model
- `search_results(search_id, fqdn, section, rank, score, signals jsonb, reasons jsonb, status, upfront_cents, renew_cents, source)` (spec 012).
- `feedback(id, search_id, fqdn, vote smallint, visitor_hash text, created_at)` — `visitor_hash` = HMAC(IP+UA, daily salt), unique `(search_id, fqdn, visitor_hash)`.
- `result_events(search_id, fqdn, action text, created_at)` — actions: `buy_click`, `copy`, `save`, `watch` (anonymous).

```ts
export interface Signals {
  R: number;      // relevance 0..1 (Jev rank_fit, confidence-shrunk) or deterministic estimate
  Q: number;      // quality (spec 004)
  T: number;      // TLD fit 0..1
  K: number;      // keyword coverage
  P: number;      // price value within section
  lift?: number;  // round-1 lift
  brand?: number; negative?: number;
  penalties: Record<string, number>;
  source: 'jev' | 'deterministic';
}
```

## 4. Interfaces

```ts
rankRound1(cands: Candidate[], state, jev): Promise<Candidate & { lift: number }[]>   // → 45
rankRound2(top: Candidate[], tldPool: string[], state, jev): Promise<Ranked[]>       // R, brand, negative, T map
pair(ranked: Ranked[], tldFit: Map<string, number>, prefs, bandTlds?: string[]): Pair[]
finalScore(p: PricedPair, w: Weights): number
sectionize(results: Scored[], cfg): Record<Tier | 'dropping' | 'unpriced', Scored[]>
reasonsFor(r: Scored, profile: SiteProfile): Reason[]            // 1–3
```

## 5. Algorithms and logic

### 5.1 Round 1 (FR-RANK-001)
```
shards = chunk(candidates sorted by (0.5Q + 0.5K) desc, 250)          // ≤ 4 shards
ask Jev: rank_shard__i over shard i (keys o000…, values labels)       // one request, ≤ 4 questions
lift(c) = p(c) × |shard(c)|                                           // >1 = better than uniform; comparable across shards
pick top 15 by lift per shard; fill to 60 by deterministic score; trim to 45 by rank-average(lift rank, det rank),
   both ranks measured within the 60 picked (2026-10-04: a deterministic rank among all candidates drowned Jev's clear favourites)
fallback: top 45 by deterministic score
```

### 5.2 Round 2 (FR-RANK-002, 003, 004)
```
for each of 45: rank_fit__n (score 0–4), risk_brand__n (noul), risk_negative__n (noul)
tld_fit (choice over pool ≤ 80)
R = conf·(score/4) + (1 − conf)·0.5                                   // shrink uncertain ratings to middle
exclude if brand ≥ RANK_BRAND_MAX (0.50) or negative ≥ RANK_NEGATIVE_MAX (0.60)
T(tld) = p(tld)/max p ; T(com) = max(T(com), 0.6) ; preferred → max(T, 0.9)   (FR-RANK-011)
```

### 5.3 Pairing (FR-RANK-005)
```
tldsFor(label) = top 6 TLDs by T  ∪ prefs.preferredTlds ∪ {hackTld} ∪ bandTlds (find-more)
fqdns = label + '.' + tld  (skip if length > 63 or restricted 'blocked_for_public')
cap total at 300; drop lowest (R·T) pairs first
```

### 5.4 Final score (FR-RANK-006, 007)
```
S = wR·R + wQ·Q + wT·T + wK·K + wP·P − Σpenalties
defaults: wR 0.45, wQ 0.20, wT 0.15, wK 0.10, wP 0.10
P (price value within section):
   budget/mid: 1 − (upfront − sectionMin) / (sectionMax − sectionMin)
   premium:    1 / (1 + log10(upfront / 30_000))
   free:       providerFit (spec 007)
penalties: hyphen 0.05 · digit 0.05 · likely_available 0.10 · unknown 0.20 · restricted TLD 0.05 · renew warning 0.05
taken → removed ; dropping_soon → 'dropping' list (FR-RANK-015)
deterministic mode (FR-RANK-014): R = 0.6K + 0.4Q ; T from FLAG_TLDS order (1.0, 0.9, 0.8 …) ; source='deterministic'
```

### 5.5 Sections and diversity (FR-RANK-008, 009)
```
for each tier: sort by S desc
  greedy take while: count(label) < 3 and share(strategy in top 20) ≤ 0.4
  first page 20; 'Show more' pages of 20 from the same ordered list
same label may appear in different tiers (open question 2 in spec)
```

### 5.6 Reasons (FR-RANK-010)
Template catalog (`reasons/templates.ts`), each with a trigger on signals; pick top 3 by priority:

| Reason id | Trigger | Text |
|---|---|---|
| `keyword` | K ≥ 0.3 | Contains your key word "{term}" |
| `excellent_fit` | source=jev and R ≥ 0.85 | Rated an excellent fit for your site |
| `short` | length ≤ 8 and Q ≥ 0.7 | Short and easy to say ({n} letters) |
| `tld_fit` | T ≥ 0.7 and tld in FLAG_TLDS of an on flag | ".{tld}" suits {featureLabel} |
| `tld_trust` | tld = com | ".com" is the most recognised extension |
| `local` | tld in GEO_TLDS[geo] | Local extension for {country} |
| `brandable` | strategy = brandable and Q ≥ 0.7 | Unique, brandable name |
| `hack` | strategy = hack | The extension completes the word |
| `value` | P ≥ 0.8 | Great price for this section |
`reasons.test.ts` asserts each shown reason's trigger holds (NFR-RANK-003).

### 5.7 Re-ranking after chip edits (FR-RANK-016)
The client sends `featureEdits`; server rebuilds state; Jev answers are memoized per `(question id@v, state hash, label)`;
changed state ⇒ new answers only for questions whose state changed (R/T), brand/negative answers reused (label-only).
Implementation: `risk_brand`/`risk_negative` sent with a **label-only state** so their memo key does not depend on features.

### 5.8 Feedback and weight tuning (FR-RANK-012, 013)
- `POST /api/feedback { searchId, fqdn, vote }` → upsert on `(search_id, fqdn, visitor_hash)`; rate-limited 60/h.
- Monthly job `tune-weights`: dataset = shown results with signals + label (thumbs up/buy/copy/save = 1, thumbs down = 0,
  ignored excluded) → logistic regression on (R,Q,T,K,P) → proposed weights + validation AUC → uploads
  `weights-YYYY-MM.md` as a workflow artifact. A person updates `packages/config` weights (human approval).

## 6. External services and free-tier limits
Jev only (spec 002): S5 ≈ 6k tokens, S6 ≈ 7k tokens.

## 7. Configuration and secrets
`RANK_WEIGHTS` (JSON), `RANK_BRAND_MAX=0.5`, `RANK_NEGATIVE_MAX=0.6`, `RANK_ROUND2_SIZE=45`, `RANK_SECTION_PAGE=20`,
`RANK_MAX_PER_LABEL=3`, `RANK_STYLE_MAX_SHARE=0.4`, `RANK_MAX_FQDNS=300`.

## 8. Errors, retries and fallbacks

| Failure | Response |
|---|---|
| Round 1 fails | deterministic top 45 |
| Round 2 fails partly | per-name deterministic R; brand/negative: stricter deterministic brand rules (spec 014) + profanity only |
| tld_fit fails | rule-based T |
| Feedback DB write fails | 202 accepted, dropped (non-critical), logged |

## 9. Security and privacy controls
Feedback is anonymous (`visitor_hash` rotates daily); no description stored with feedback.

## 10. Performance and cost budgets
Scoring 300 pairs + sectioning + reasons < 50 ms; Jev S5+S6 ≈ 13k tokens, ≤ 4 requests, deadline 3 s + 4 s.

## 11. Test plan

| Test | Type | What it proves |
|---|---|---|
| `round1.test.ts` | unit | sharding, lift math, top-15/shard, fallback |
| `round2.test.ts` | unit | shrinkage, exclusions, T normalization, preferred boost |
| `pair.test.ts` | unit | TLD sets, 63-char limit, cap 300 |
| `final-score.test.ts` | unit | weights, P per tier, penalties, deterministic mode |
| `sectionize.test.ts` | unit | per-tier order, max 3 per label, style share |
| `reasons.test.ts` | unit | every reason's trigger holds; max 3 |
| `memo.test.ts` | unit | chip edit re-uses label-only answers |
| `feedback.int.test.ts` | integration | upsert uniqueness, rate limit |
| eval (spec 016) | eval | NDCG@10 (jev) and degraded |

## 12. Observability
Distribution of S per section, exclusion counts (brand/negative), reasons frequency, thumbs-up rate, position-click curve.

## 13. Traceability matrix

| Requirement | Component(s) | Test(s) |
|---|---|---|
| FR-RANK-001 | `rankRound1`, `rankRound2` | `round1.test.ts`, `round2.test.ts` |
| FR-RANK-002 | `rank_fit@1`, `risk_*@1` | `round2.test.ts` |
| FR-RANK-003 | exclusions | `round2.test.ts` |
| FR-RANK-004 | `tld_fit@1`, T | `round2.test.ts` |
| FR-RANK-005 | `pair` | `pair.test.ts` |
| FR-RANK-006 | `finalScore` | `final-score.test.ts` |
| FR-RANK-007 | penalties, taken removal | `final-score.test.ts` |
| FR-RANK-008 | `sectionize` | `sectionize.test.ts` |
| FR-RANK-009 | diversity rules | `sectionize.test.ts` |
| FR-RANK-010 | `reasonsFor` | `reasons.test.ts` |
| FR-RANK-011 | preferred boost | `round2.test.ts` |
| FR-RANK-012 | `/api/feedback`, `feedback` table | `feedback.int.test.ts` |
| FR-RANK-013 | `jobs/tune-weights` | job unit test + report |
| FR-RANK-014 | deterministic mode | `final-score.test.ts`, `degraded-mode.int.test.ts` |
| FR-RANK-015 | dropping list (phase 2) | `sectionize.test.ts` |
| FR-RANK-016 | memo §5.7 | `memo.test.ts` |
| NFR-RANK-001 | full pipeline | monthly eval |
| NFR-RANK-002 | scoring perf | `rank.perf.test.ts` |
| NFR-RANK-003 | reason triggers | `reasons.test.ts` |
| NFR-RANK-004 | deterministic mode | monthly eval (degraded run) |

## 14. Risks and research links
- R-02: shard-choice lift vs per-item score quality; if shard probabilities are too peaked, switch round 1 to per-item `score` in batches (more tokens).
- R-01: questions per request (round 2 needs 136 questions → 3 requests at ≤ 50).
