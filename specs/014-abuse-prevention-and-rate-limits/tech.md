# Tech 014 — Abuse Prevention, Safety and Rate Limits

| Field | Value |
|---|---|
| Implements | [spec.md](./spec.md) |
| Status | Approved (2026-10-03) |
| Owning packages | `packages/core/safety`, `apps/web/lib/ratelimit.ts`, `apps/web/lib/turnstile.ts` |
| Last updated | 2026-10-03 |

## 1. Components and diagram

```
route handler
  ├─ turnstile.verify(token)                               FR-ABU-001
  ├─ ratelimit.check(bucket, key, cost)                    FR-ABU-002/003  (Upstash; fallback in-memory)
  ├─ globalCaps.check(resource, estimate)                  FR-ABU-004      (spec 015 budget guard)
  └─ pipeline
       S1 safety answers → safety.gate(profile)            FR-ABU-005/006
       S4 prefilter → brandRisk(label, mode)               FR-ABU-007/008  (spec 004)
       S6 risk_brand/risk_negative (Jev)                   second layer (spec 008)
```

## 2. Stack and libraries

| Concern | Choice | Notes |
|---|---|---|
| Limiter | `@upstash/ratelimit` sliding window + `@upstash/redis` REST | ~2 commands per check |
| Fallback limiter | in-memory LRU (`lru-cache`) per instance | conservative: half the normal limits |
| Human check | Cloudflare Turnstile siteverify | 2 s timeout |
| Edit distance | own Damerau-Levenshtein (bounded, early exit) | fast for short strings |

## 3. Data model
- Upstash keys: `rl:{bucket}:{visitorHash|userId}` (TTL = window), `cap:{resource}:{yyyymmdd}` (TTL 48 h),
  `idem:{clientRequestId}` (TTL 60 s), `susp:{visitorHash}` (TTL 24 h, suspicion score).
- `brand_labels` (spec 012), `supabase/seed/brands_extra.json`, `words/security_terms.json`.
- Reports: `feedback.reason` (`'offensive'|'brand'|'other'`) with `vote = -1` (spec 012).

## 4. Interfaces

```ts
type Bucket = 'search' | 'search_day' | 'recheck' | 'feedback' | 'events' | 'snapshot';
checkLimit(bucket: Bucket, key: string, cost?: number): Promise<{ ok: boolean; retryAfterSec?: number }>;
safetyGate(profile: SiteProfile): { action: 'allow' | 'refuse' | 'strict_brand' };
brandRisk(label: string, opts: { strict: boolean; descBrandTokens?: string[] }): { risky: boolean; rule?: string };
```

## 5. Algorithms and logic

### 5.1 Limits (FR-ABU-002, 003)

| Bucket | Key | Anonymous | Signed-in |
|---|---|---|---|
| `search` | visitorHash / userId | 5 per 10 min (sliding) | 10 per 10 min |
| `search_day` | same | 30 / day | 60 / day |
| `recheck` | same | 10 / min | 10 / min |
| `feedback` (incl. reports) | same | 60 / h | 60 / h |
| `events` | same | 120 / h | 120 / h |
| `snapshot` (GET /api/search/{ref}) | same | 60 / min | 60 / min |
`more`/`refine` cost 0.5 in `search` and `search_day`. Suspicion multiplier (5.4) divides limits by 2–5.
"Signed-in" means a session with `is_anonymous = false`; anonymous sessions created for saving (spec 011 §5.6) use
the Anonymous column, so saving never raises limits. Limits confirmed by the owner on 2026-10-03.
Request size (FR-ABU-009): description ≤ 2,000 characters (zod), body ≤ 16 KB (checked from `Content-Length` and
while reading), exclusion lists ≤ 500 items.

### 5.2 Brand risk (FR-ABU-007, 008)
```
norm(s) = lowercase → map {0:o,1:l,3:e,4:a,5:s,7:t,8:b,@:a,$:s} → replace 'rn'→'m','vv'→'w','cl'→'d' (variant set)
brands  = brand_labels (≥ 4 chars, excluding common dictionary words) ∪ brands_extra
for v in variants(norm(label)) and each segment of v:
   exact:     v ∈ brands                                              → risky
   contains:  any brand b (len ≥ 5) where b ⊂ v                       → risky
   typo:      len(b) ≥ 6 and DL(v_or_segment, b) ≤ 1                  → risky
   combo:     segment ∈ brands (len ≥ 4) and any segment ∈ SECURITY_TERMS  → risky
strict mode: also contains for len ≥ 4 and DL ≤ 2 for len ≥ 8; description brand tokens (proper nouns matching brands) banned outright
```
Index: brands bucketed by length and first 2 chars for typo checks; contains via Aho-Corasick automaton built once per instance.

### 5.3 Safety gate (FR-ABU-005, 006)
```
if safety_phishing ≥ 0.80 or safety_illegal ≥ 0.80 → refuse ('safety')
if safety_impersonation ≥ 0.70 → strict_brand
fallback (Jev unavailable): keyword rules (phishing/credential/clone/"looks like <brand>" patterns) → refuse or strict
```
Refusal message (UI): "We can't help with this request. If you think this is a mistake, tell us." No details echoed.

### 5.4 Suspicion scoring (FR-ABU-010)
Per visitorHash, in Upstash (`susp:*`), +1 each: search without any subsequent interaction event within 10 min (checked lazily
on next search), identical `cache_key` from > 5 visitors within 10 min (global counter `dup:{cache_key}`), > 3 searches within 60 s.
Score ≥ 3 → limits ÷ 2; ≥ 6 → ÷ 5 and Turnstile forced to interactive mode.

### 5.5 Fallback limiter (FR-ABU-012)
If Upstash errors: in-memory sliding window with half limits per instance; log `ratelimit.fallback`.

### 5.6 Reports (FR-ABU-013)
`POST /api/feedback { vote: -1, reason }` → stored; weekly owner review via a SQL view `reports_last_7_days`; confirmed
problems → add to `brands_extra.json` / profanity list (new catalog/list version).

## 6. External services and free-tier limits

| Service | Used for | Limit | Source | Verified |
|---|---|---|---|---|
| Upstash Redis | rate limits, caps | 500k commands/month free | upstash.com/pricing | R-09 |
| Cloudflare Turnstile | human check | free | developers.cloudflare.com/turnstile | R-09 |

Command budget: ~6 Upstash commands per search (2 limit buckets × 2, cap check, idempotency) × 6,000 searches ≈ 36k/month
+ rechecks/feedback/events ≈ 100k → well under 500k.

## 7. Configuration and secrets
`UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`, `TURNSTILE_SECRET_KEY`, `RL_*` limits, `SAFETY_*` thresholds, `BRAND_*` rule params.

## 8. Errors, retries and fallbacks

| Failure | Response |
|---|---|
| Upstash down | in-memory fallback §5.5 |
| Turnstile down | allow with `strict` bucket (limits ÷ 2) |
| Brand list missing | use seed `brands_extra.json` + Jev `risk_brand` with threshold 0.4 |

## 9. Security and privacy controls
Visitor fingerprints only as HMAC with daily salt; no descriptions in refusal logs (only counts by category).

## 10. Performance and cost budgets
Turnstile verify ~100 ms, Upstash ~20 ms per call (parallel), brandRisk < 0.1 ms per label (1,000 labels < 100 ms).

## 11. Test plan

| Test | Type | What it proves |
|---|---|---|
| `ratelimit.test.ts` | unit (mock redis) | buckets, costs, retryAfter, suspicion multiplier |
| `ratelimit-fallback.test.ts` | unit | fail-safe limits |
| `brand-risk.test.ts` | unit | exact/contains/typo/combo/homoglyph cases (≥ 200 table-driven cases), dictionary-word allowance |
| `safety-gate.test.ts` | unit | thresholds, fallback keyword rules |
| `abuse.spec.ts` | e2e | limit message with time; refusal message; report hides result |
| red-team set | eval | 50 phishing/impersonation descriptions → 100% refused or strict; 50 benign → 0 refused |

## 12. Observability
Counters: limited requests by bucket, refusals by category, strict-mode activations, brand exclusions by rule, reports per week.

## 13. Traceability matrix

| Requirement | Component(s) | Test(s) |
|---|---|---|
| FR-ABU-001 | `turnstile.ts` | `search-route.int.test.ts` |
| FR-ABU-002 | limits §5.1 | `ratelimit.test.ts` |
| FR-ABU-003 | limits §5.1 | `ratelimit.test.ts` |
| FR-ABU-004 | global caps (spec 015) | `budget-guard.test.ts`, `caps.test.ts` |
| FR-ABU-005 | `safetyGate` | `safety-gate.test.ts`, red-team set |
| FR-ABU-006 | strict mode | `safety-gate.test.ts`, `brand-risk.test.ts` |
| FR-ABU-007 | `brandRisk` | `brand-risk.test.ts` |
| FR-ABU-008 | combo rule | `brand-risk.test.ts` |
| FR-ABU-009 | zod limits (2,000 chars), 16 KB body cap | `schema.test.ts` |
| FR-ABU-010 | suspicion §5.4 | `ratelimit.test.ts` |
| FR-ABU-011 | 429 body + UI | `abuse.spec.ts` |
| FR-ABU-012 | fallback limiter | `ratelimit-fallback.test.ts` |
| FR-ABU-013 | reports §5.6 | `abuse.spec.ts`, `feedback.int.test.ts` |
| FR-ABU-014 | counters | `safety-gate.test.ts` (metric emitted) |
| NFR-ABU-001 | limits tuning | prod metrics |
| NFR-ABU-002 | parallel checks | `search-route.perf.test.ts` |
| NFR-ABU-003 | layered brand checks | weekly audit sample |
| NFR-ABU-004 | caps | monthly budget report |

## 14. Risks and research links
- R-12 (brand list source). Risk: over-blocking common words that are brands → dictionary allowance + Jev second opinion + reports.
