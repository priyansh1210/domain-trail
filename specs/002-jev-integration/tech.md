# Tech 002 — Jev Decision-Model Integration

| Field | Value |
|---|---|
| Implements | [spec.md](./spec.md) |
| Status | Approved (2026-10-03) |
| Owning packages | `packages/jev` |
| Contract | [contracts/jev-systemone.schema.json](./contracts/jev-systemone.schema.json) |
| Catalog | [questions/catalog.md](./questions/catalog.md) |
| Last updated | 2026-10-03 |

## 1. Components and diagram

```
packages/core (pipeline stages)
      │  ask(group: QuestionGroup, state) : Promise<Answers | Fallback>
      ▼
packages/jev
  ├─ catalog/            question definitions (id@version) as typed TS objects
  ├─ batcher.ts          splits questions into requests (≤ MAX_QUESTIONS_PER_REQUEST, ≤ token limits)
  ├─ budget.ts           checks/records token usage (daily + monthly caps)
  ├─ breaker.ts          circuit breaker (per route)
  ├─ transport.ts        fetch → gateway (primary) / direct (secondary), timeout, retries
  ├─ schemas.ts          zod schemas for request + answers (mirrors contracts/*.json)
  ├─ fallback/           deterministic replacements per question group
  ├─ fixtures/           recorded responses (JSON) for tests
  └─ eval/               golden-set runner + report writer
```

## 2. Stack and libraries

| Concern | Choice | Notes |
|---|---|---|
| HTTP | native `fetch` (Node 22) + `AbortController` | We call the REST API directly for full control over retries/timeouts. The official `@typesafe-ai/sdk` is optional and not required. |
| Validation | zod | answers validated per question type |
| Budget store | Supabase RPC `jev_usage_add` (spec 012) + in-memory 60 s cache of month total | 1 write per search |
| Test mocks | MSW | serves `fixtures/*.json` |

## 3. API facts used (verified 2026-09-29)

| Fact | Value | Source |
|---|---|---|
| Endpoint (direct) | `POST https://api.typesafe.ai/v1/systemone` | flaviocopes.com/jev-api-key |
| Endpoint (gateway) | `POST https://ai-gateway.vercel.sh/typesafe/v1/systemone` | flaviocopes.com/jev-api-key |
| Models endpoint | `GET /v1/models` (gateway: `GET /typesafe/v1/models`) | same |
| Model name on the gateway | `maker/model`, e.g. `typesafe-ai/jev`; the transport sends `typesafe-ai/<JEV_MODEL>` and strips the prefix from responses. Errors: `{ message, error_type }` | vercel.com/docs/ai-gateway/sdks-and-apis/typesafe (2026-10-04) |
| Auth | `Authorization: Bearer <key>` (`TYPESAFE_API_KEY` or `AI_GATEWAY_API_KEY`) | same |
| Body | `{ model, state, questions: { <name>: { type, instructions, criteria? } } }` | daleseo.com/jev |
| Types | `choice` (criteria = object key→description, ≤ 255 keys), `score` (criteria = ordered array, 2–10 levels), `noul` (no criteria) | daleseo.com/jev |
| Answer: choice | `{ type, choice, probabilities: {key: p}, confidence }` | daleseo.com/jev |
| Answer: score | `{ type, score, probabilities, legend, confidence }` | daleseo.com/jev |
| Answer: noul | `{ type, noul }` | daleseo.com/jev |
| Usage | `usage: { input_tokens, output_tokens }` | flaviocopes.com |
| Request id | response header `x-typesafe-request-id` | flaviocopes.com |
| Limits | 64k tokens context; state + longest question ≤ 32k; 250k tokens/s; 1,200 req/min | cometapi.com |
| Latency | 70–500 ms typical | cometapi.com |
| Errors | 401 bad key · 422 invalid body · 429 rate limit · 529 overloaded | flaviocopes.com |
| Models | `jev-latest`, `jev-preview` (aliases), `jev-1.13.0` (pinned) | flaviocopes.com |
| Price | $0.042 / 1M input tokens, output free | cometapi.com |
| Free credit | Vercel AI Gateway: $5 every 30 days per team (Jev billed from it) | vercel.com/docs/ai-gateway/pricing |

Unknown / to verify (R-01): max questions per request, whether option keys have character restrictions,
the exact shape of score `probabilities` (array vs object), data-retention policy of TypeSafe and the gateway.

## 4. Interfaces

```ts
// packages/jev/types.ts
export type QuestionType = 'choice' | 'score' | 'noul';

export interface QuestionDef<T extends QuestionType = QuestionType> {
  id: string;              // e.g. 'site_type'
  version: number;         // bump on any wording/criteria change
  type: T;
  instructions: string;    // may contain {placeholders} filled at runtime (e.g. {label})
  criteria?: T extends 'choice' ? Record<string, string>
           : T extends 'score'  ? string[]
           : never;
  group: 'features' | 'keywords' | 'rank_r1' | 'rank_r2' | 'tld_fit' | 'safety';
}

export type Answer =
  | { type: 'choice'; choice: string; probabilities: Record<string, number>; confidence: number }
  | { type: 'score'; score: number; probabilities: number[] | Record<string, number>;
      legend?: Record<string, string>; confidence: number }
  | { type: 'noul'; noul: number };

export interface AskResult {
  answers: Record<string, Answer>;          // key = question name sent (id or id__suffix)
  failed: string[];                         // question names that need fallback
  usage: { inputTokens: number; requests: number };
  requestIds: string[];
  degraded: boolean;                        // true if any fallback used
  modelVersion: string;
}

export interface DecisionService {
  ask(params: {
    state: unknown;                         // JSON-serializable
    questions: Array<{ name: string; def: QuestionDef; vars?: Record<string, string>;
                       criteriaOverride?: Record<string, string> | string[] }>;
    stageDeadlineMs: number;                // hard deadline for this stage
    searchId: string;
  }): Promise<AskResult>;
}
```

Question names sent to Jev: `${id}` for single questions, `${id}__${n}` for per-candidate questions
(e.g. `rank_fit__17`). The mapping `n → candidate` stays server-side.

## 5. Algorithms and logic

### 5.1 Batching (`batcher.ts`)
```
input: questions[], state
stateTokens = estimateTokens(JSON.stringify(state))          // chars/3.5, conservative
sort questions by estimated size desc
requests = []
for q in questions:
   put q into the first request r where
       r.count < MAX_QUESTIONS_PER_REQUEST (config, default 50)
       and stateTokens + r.tokens + q.tokens <= 60_000
       and stateTokens + q.tokens <= 31_000                   // "state + longest question ≤ 32k"
   else open a new request
send all requests in parallel (Promise.allSettled), respecting a per-search concurrency of 4
```

### 5.2 Transport, retries, timeouts (`transport.ts`)
- Per-request timeout: `min(8_000 ms, stageDeadline - now)`.
- Retry on 429, 529, 5xx and network errors: max 2 retries, backoff 300 ms → 900 ms with ±20% jitter;
  honour `Retry-After` if present and it fits inside the stage deadline.
- No retry on 401/422 (config/code bug → alert immediately, see spec 015).
- Route selection: `JEV_ROUTE=gateway|direct`. If the primary route returns 401/5xx for > 50% of calls in 5 min
  and `JEV_ALLOW_ROUTE_FAILOVER=true`, switch to the secondary route (direct use is billed to TypeSafe account,
  so failover is **off by default** to respect constitution P1).

### 5.3 Circuit breaker (`breaker.ts`)
- Closed → Open after 5 failed requests within 60 s (per server instance).
- Open for 30 s: all asks return `failed = all` immediately (fallback).
- Half-open: allow 1 probe request; success → Closed, failure → Open again.

### 5.4 Answer validation (`schemas.ts`)
- zod schema per type; additionally:
  - `choice`: `choice ∈ keys(criteria)`; probabilities keys ⊆ criteria keys; `|Σp − 1| ≤ 0.02` → renormalize; else fail.
  - `score`: `0 ≤ score ≤ levels−1`; probabilities length = levels (if array) → normalize.
  - `noul`: `0 ≤ noul ≤ 1`.
- Failed validation → that question name goes into `failed`, logged with request id.

### 5.5 Budget guard (`budget.ts`)
```
before ask:
  est = estimateTokens(all requests)
  month = cachedMonthTotal()               // refreshed from DB every 60 s
  day   = cachedDayTotal()
  if month + est > JEV_MONTHLY_TOKEN_CAP or day + est > JEV_DAILY_TOKEN_CAP:
      return all-failed (degraded, reason='budget')
after search completes:
  rpc jev_usage_add(date=today_utc, tokens=sum(usage.input_tokens), requests=n, degraded=bool)
```
Defaults (config): `JEV_MONTHLY_TOKEN_CAP = 100_000_000` (≈ $4.20 of the $5 credit),
`JEV_DAILY_TOKEN_CAP = 4_000_000`, `JEV_EVAL_MONTHLY_TOKEN_CAP = 10_000_000` (tracked separately).

### 5.6 Token budget per search (estimate)

| Stage | Requests | Questions | Est. input tokens |
|---|---|---|---|
| S1 features + safety | 2 (parallel) | ~56 | ~5,000 |
| S2 keyword weights + expansion fit | 1 | 2 (≤ 60 and ≤ 255 options) | ~2,500 |
| S5 ranking round 1 | 1–2 | 4 shards × ≤ 250 options | ~6,000 |
| S6 ranking round 2 (45 candidates) | 3 (parallel) | 45 × 3 + 1 TLD choice = 136 | ~7,000 |
| **Total** | **7–8** | | **~20,500** |

At 100M tokens/month → ≈ 4,900 uncached searches/month; cached searches cost 0.
Actual usage is measured from `usage.input_tokens`; estimates only drive the pre-check.

### 5.7 Fallbacks (`fallback/`)

| Group | Fallback |
|---|---|
| features | keyword rules: site-type/industry keyword dictionaries (seed JSON in `supabase/seed/taxonomy.json`), geo from country/city names, tone = neutral, all feature flags from keyword matches |
| keywords | TF-IDF-like weights from wink-nlp term frequency × noun-phrase bonus; expansion fit = keep Datamuse top-N by Datamuse score |
| rank_r1 / rank_r2 | deterministic score only (quality + keyword coverage, spec 008) |
| tld_fit | rule table feature→TLDs (spec 003 tech) |
| safety | keyword blocklist + brand list check (spec 014); if safety questions fail, the search continues but brand-lookalike rules are made stricter |

### 5.8 Model pinning and evaluation (`eval/`)
- `JEV_MODEL=jev-1.13.0` in production; `jev-preview` only in the eval workflow.
- Golden set: `packages/jev/eval/golden.jsonl` (≥ 60 descriptions; see spec 016) with expected site type,
  industry, geo, top feature flags, and a list of "good" and "bad" names per description.
- Weekly workflow (`weekly-jev-eval.yml`): runs S1 on all golden items for pinned + preview models; monthly
  runs the full pipeline for 20 items. Writes `eval/reports/YYYY-MM-DD.md` (accuracy, calibration (Brier score),
  ranking NDCG@10 against "good" names, tokens used) and commits it to the `eval-reports` branch of the repository
  (owner decision: a repository file is enough, no e-mail). The workflow uses `GITHUB_TOKEN` with `contents: write`
  scoped to that branch; reports contain only golden-set data (no user data), so being public is fine.
- Upgrade procedure: new version must be ≥ pinned on every metric (within 1 point) → owner approves → change
  `JEV_MODEL` → bump `PIPELINE_VERSION` (invalidates result cache).

### 5.9 Catalog as code
- `packages/jev/catalog/*.ts` exports `QuestionDef` objects; `catalog.md` (this spec) is the human-readable
  mirror. A unit test fails if `catalog.md` and the code catalog disagree (ids, versions, types, option counts),
  generated via `pnpm jev:catalog:check`.
- Answers stored with a search include `id@version` so old results remain interpretable.

## 6. External services and free-tier limits

| Service | Used for | Free-tier limit | Source | Verified |
|---|---|---|---|---|
| Vercel AI Gateway | Route to Jev with free credit | $5 credit every 30 days per team | vercel.com/docs/ai-gateway/pricing | 2026-09-29 |
| TypeSafe Jev | Decisions | $0.042 / 1M input tokens; 1,200 req/min | cometapi.com, flaviocopes.com | 2026-09-29 |

## 7. Configuration and secrets

| Env var | Where | Purpose |
|---|---|---|
| `AI_GATEWAY_API_KEY` | Vercel (server), GitHub Actions (eval) | primary route auth |
| `TYPESAFE_API_KEY` | optional, server | secondary (direct) route |
| `JEV_ROUTE` | Vercel | `gateway` (default) or `direct` |
| `JEV_ALLOW_ROUTE_FAILOVER` | Vercel | default `false` |
| `JEV_MODEL` | Vercel, Actions | pinned version, default `jev-1.13.0` |
| `JEV_MAX_QUESTIONS_PER_REQUEST` | config | default 50 until R-01 |
| `JEV_MONTHLY_TOKEN_CAP`, `JEV_DAILY_TOKEN_CAP`, `JEV_EVAL_MONTHLY_TOKEN_CAP` | config | budget guard |
| `JEV_REQUEST_TIMEOUT_MS` | config | default 8000 |
| `JEV_MODE` | local/test | `live` or `fixtures` |

## 8. Errors, retries and fallbacks

| Failure | Detection | Response |
|---|---|---|
| 401 | status | no retry; fallback; Sentry alert "Jev auth" (P1) |
| 422 | status | no retry; fallback; Sentry error with question ids (catalog bug) |
| 429 / 529 / 5xx | status | retry ×2 with backoff, then fallback |
| Timeout | AbortController | fallback for that request's questions |
| Invalid answer | zod / checks | fallback for that question |
| Budget exceeded | budget.ts | degraded for whole search, banner reason `budget` |
| Breaker open | breaker.ts | immediate fallback |

## 9. Security and privacy controls
- `state` is built by a single function `buildState(stage, ctx)` that whitelists fields; unit test asserts that
  no e-mail/user id/IP can appear in it.
- API keys only in server env; never shipped to the browser; Jev is never called from the client.
- Logs contain question ids, token counts and request ids — never the description text.
- Data-retention terms of TypeSafe/gateway disclosed in the privacy policy (spec 013) once R-01 confirms them.

## 10. Performance and cost budgets
See §5.6. Stage deadlines: S1 4 s, S2 3 s, S5 3 s, S6 4 s (config). Total Jev time p95 < 6 s (stages overlap with
Datamuse/DoH work).

## 11. Test plan

| Test | Type | What it proves |
|---|---|---|
| `batcher.test.ts` | unit | limits respected (count, 32k/64k), deterministic grouping |
| `schemas.test.ts` | unit | valid/invalid answers per type, renormalization tolerance |
| `transport.test.ts` | unit + MSW | retries on 429/529/5xx, none on 401/422, timeout, Retry-After |
| `breaker.test.ts` | unit | open/half-open/close transitions |
| `budget.test.ts` | unit | caps block requests, usage recorded once per search |
| `state-privacy.test.ts` | unit | no personal fields in state |
| `catalog-sync.test.ts` | unit | catalog.md ↔ code catalog consistency |
| `contract.test.ts` | contract | fixtures validate against `contracts/jev-systemone.schema.json` |
| `live-smoke.test.ts` | live (nightly, opt-in) | one real call per question type succeeds on pinned model |
| weekly eval | evaluation | quality metrics vs golden set |

## 12. Observability
Per request: `jev.request` log {searchId, stage, questions, inputTokens, latencyMs, status, requestId, route}.
Metrics (spec 015): tokens/search, degraded-rate, p95 latency per stage, breaker opens/day, budget % used.

## 13. Traceability matrix

| Requirement | Component(s) | Test(s) |
|---|---|---|
| FR-JEV-001 | `packages/jev/index.ts` (only export), ESLint `no-restricted-imports` for transport | lint rule test |
| FR-JEV-002 | `catalog/*.ts`, `questions/catalog.md` | `catalog-sync.test.ts` |
| FR-JEV-003 | `JEV_MODEL` config + zod refine (rejects `-latest`/`-preview` in production) | `config.test.ts` |
| FR-JEV-004 | `schemas.ts` | `schemas.test.ts`, `contract.test.ts` |
| FR-JEV-005 | `transport.ts` | `transport.test.ts` |
| FR-JEV-006 | `transport.ts` deadlines | `transport.test.ts` |
| FR-JEV-007 | `breaker.ts` | `breaker.test.ts` |
| FR-JEV-008 | `budget.ts`, `jev_usage` table | `budget.test.ts` |
| FR-JEV-009 | `budget.ts` | `budget.test.ts`, `degraded-mode.int.test.ts` |
| FR-JEV-010 | `transport.ts` route config | `transport.test.ts` |
| FR-JEV-011 | `transport.ts` logging | `transport.test.ts` (asserts log field) |
| FR-JEV-012 | `batcher.ts` | `batcher.test.ts` |
| FR-JEV-013 | `buildState()` | `state-privacy.test.ts` |
| FR-JEV-014 | `fixtures/`, `JEV_MODE=fixtures` | whole unit/integration suite runs offline in CI |
| FR-JEV-015 | `eval/`, `weekly-jev-eval.yml` | report file committed to `eval-reports` branch |
| FR-JEV-016 | `fallback/*` | `fallback.test.ts`, `degraded-mode.int.test.ts` |
| FR-JEV-017 | per-search answer memo (`Map<hash(question+state), Answer>`) | `memo.test.ts` |
| NFR-JEV-001 | transport metrics | prod metrics, `live-smoke.test.ts` |
| NFR-JEV-002 | stage deadlines | `pipeline.perf.test.ts` |
| NFR-JEV-003 | budget estimates §5.6 | `token-estimate.test.ts` against fixtures' usage |
| NFR-JEV-004 | caps §5.5 | monthly usage report (spec 015) |
| NFR-JEV-005 | fallback path | `degraded-mode.int.test.ts` |
| NFR-JEV-006 | eval runner | weekly eval report |

## 14. Risks and research links
- R-01: max questions per request, option-key rules, score-probability shape, retention policy.
- R-02: whether shard-level `choice` probabilities rank as well as per-item `score` (evaluate both on golden set).
- Risk: Jev is 2 weeks old — API may change. Mitigation: pinned version, contract tests, nightly live smoke test.
