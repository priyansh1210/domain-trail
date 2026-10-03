# Tech 001 — Website Description Intake

| Field | Value |
|---|---|
| Implements | [spec.md](./spec.md) |
| Status | Approved (2026-10-03) |
| Owning packages | `apps/web/app/(marketing)/page.tsx`, `apps/web/app/api/search/route.ts`, `packages/core/intake` |
| Last updated | 2026-10-03 |

## 1. Components and diagram

```
Home page (RSC + client form)
  ├─ <DescriptionForm>  textarea, counter, example chips, <PreferencesPanel>, Turnstile widget (invisible)
  └─ submit → POST /api/search  { description, preferences, turnstileToken, clientRequestId }
                 │
                 ▼
route handler /api/search (Node runtime)
  1. zod validate body                         (FR-INT-002, 004)
  2. Turnstile siteverify                      (FR-INT-006)
  3. rate limit (spec 014)                     (FR-INT-006)
  4. normalize(description)                    (FR-INT-007, 011)
  5. key = sha256(normalized + canonical(prefs) + PIPELINE_VERSION)
  6. result_cache lookup (spec 012)            (FR-INT-008)
  7. respond with Content-Type: text/event-stream (the POST response itself is the stream):
       first event  `search_created { searchId, cached }`
       hit  → emit stored results, then availability re-checks for expired entries, then `done`
       miss → create search row (status=running) → run pipeline S1–S9 in this request (spec 009 events)
  8. client stores description in sessionStorage[searchId]  (FR-INT-012) and navigates to /s/{id}.{hmac8}
```

**Why the POST response is the stream:** the pipeline needs the description, and anonymous descriptions are
never stored on the server (FR-INT-012). Streaming the POST response keeps the description in memory for the
life of that one request only. The client reads it with `@microsoft/fetch-event-source` (supports POST).
If the page reloads mid-search, the client re-POSTs using the description in `sessionStorage`; if the search
already finished, the cache key makes it an instant cache hit. Shared links (no sessionStorage) load the
persisted snapshot via `GET /api/search/{id}`.

## 2. Stack and libraries

| Concern | Choice | Notes |
|---|---|---|
| Form | React client component + `react-hook-form` + `zodResolver` | same zod schema on client + server |
| Human check | Cloudflare Turnstile, invisible/managed mode | `@marsidev/react-turnstile` wrapper |
| Normalization | `String.prototype.normalize('NFKC')`, regexes | no dependency |
| Hashing | Node `crypto.createHash('sha256')` | |
| IDs | `uuidv7` | search ids (unguessable because of 74 random bits + UUID in URL; see §9) |

## 3. Data model
Uses (defined in spec 012):
- `searches(id uuid pk, user_id uuid null, cache_key text, status text, prefs jsonb, created_at, …)`
- `result_cache(cache_key text pk, search_id uuid, created_at, expires_at)`

For anonymous users, **no description column is written** (spec 013). For signed-in users who save the
search, the description is written to `saved_searches` (spec 011), not to `searches`.

## 4. Interfaces

```ts
// packages/core/intake/schema.ts
export const PreferencesSchema = z.object({
  preferredTlds: z.array(z.string().regex(/^[a-z0-9-]+(\.[a-z0-9-]+)?$/)).max(20).default([]),
  maxLength: z.number().int().min(6).max(20).default(15),
  allowHyphens: z.boolean().default(false),
  allowDigits: z.boolean().default(true),               // owner decision 2026-10-03
  country: z.string().regex(/^(auto|global|[a-z]{2})$/).default('auto'),
  priceMinCents: z.number().int().min(0).default(0),
  priceMaxCents: z.number().int().min(0).nullable().default(null), // null = no upper limit
  includeFree: z.boolean().default(true),
  forceSearch: z.boolean().default(false),                         // "Search anyway" after vague prompt
}).refine(p => p.priceMaxCents === null || p.priceMaxCents >= p.priceMinCents);

export const SearchRequestSchema = z.object({
  description: z.string().transform(normalize).pipe(z.string().min(20).max(2000)),
  preferences: PreferencesSchema,
  turnstileToken: z.string().min(1),
  clientRequestId: z.string().uuid(),   // idempotency
});
```

`POST /api/search` responses (see spec 009 OpenAPI):
- `200 text/event-stream` — events defined in spec 009 (`search_created`, `features`, `batch`, `update`, `needs_detail`, `refused`, `degraded`, `done`, `error`)
- `400 { error: 'validation', fields }` · `403 { error: 'human_check_failed' }` · `429 { error: 'rate_limited', retryAfterSec }`
  (these are returned as normal JSON responses **before** the stream starts)
- Safety refusal is detected in S1 and sent as the `refused` event (spec 014).

The vague-description prompt is delivered as an SSE event `needs_detail` after S1 (clarity score < 1.0) unless
`forceSearch = true`; the pipeline stops after S1 in that case (costs only the S1 tokens).

## 5. Algorithms and logic

```ts
function normalize(raw: string): string {
  let s = raw.normalize('NFKC');
  s = s.replace(/[​-‍﻿­]/g, '');       // zero-width + soft hyphen
  s = s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, ''); // control chars
  s = s.replace(/https?:\/\/\S+|www\.\S+/gi, ' ');           // URLs          (FR-INT-011)
  s = s.replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, ' ');            // e-mails
  s = s.replace(/\+?\d[\d\s().-]{7,}\d/g, ' ');                // phone numbers
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}
// removedParts flags are returned so the UI can say "we removed a link/e-mail/phone number".

function canonicalPrefs(p: Preferences): string {
  return JSON.stringify({ ...p, preferredTlds: [...p.preferredTlds].sort() }, Object.keys(p).sort());
}
```

Idempotency: `clientRequestId` is stored in Upstash for 60 s (`SET NX`) → a duplicate submit returns the same `searchId`.

Cache-hit path: the stored `search_results` are returned; any result whose `domain_checks.expires_at < now()` is
re-checked in the stream (spec 005), so reused results are never stale.

## 6. External services and free-tier limits

| Service | Used for | Free-tier limit | Source | Verified |
|---|---|---|---|---|
| Cloudflare Turnstile | human check | free, unlimited challenges (managed mode) | developers.cloudflare.com/turnstile | R-09 |
| Upstash Redis | idempotency key + rate limit | 500k commands/month | upstash.com/pricing | R-09 |

## 7. Configuration and secrets

| Env var | Where | Purpose |
|---|---|---|
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | Vercel (public) | widget |
| `TURNSTILE_SECRET_KEY` | Vercel (server) | siteverify |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | Vercel (server) | idempotency, limits |
| `DESCRIPTION_MIN`, `DESCRIPTION_MAX` | config | 20 / 2000 |
| `RESULT_CACHE_TTL_HOURS` | config | 24 |

## 8. Errors, retries and fallbacks

| Failure | Detection | Response |
|---|---|---|
| Turnstile API down/timeout (2 s) | fetch error | fail-open, apply "strict" rate-limit bucket (spec 014) |
| Supabase down during cache lookup | error | skip cache, continue, mark `persist=false` |
| Upstash down | error | idempotency skipped; in-memory limiter (spec 014) |
| Validation error | zod | 400 with field messages shown inline |

## 9. Security and privacy controls
- Server re-validates everything (never trusts client validation).
- Description never logged; Sentry `beforeSend` strips request bodies for `/api/search` (spec 013).
- Search ids are UUIDv7 (time-ordered) — to avoid guessable neighbours, results URLs use `/s/{id}.{hmac8}` where
  `hmac8 = first 8 chars of HMAC(SEARCH_LINK_SECRET, id)`; requests with a wrong suffix → 404.
- Body size limit 8 KB on the route.

## 10. Performance and cost budgets
- Route handler work before 202: < 300 ms p95 (Turnstile ~100 ms, Upstash ~20 ms, Supabase ~50 ms).
- Home page JS < 150 KB gz: Turnstile loaded lazily on first focus of the textarea.

## 11. Test plan

| Test | Type | What it proves |
|---|---|---|
| `schema.test.ts` | unit | limits, defaults, price-range refine |
| `normalize.test.ts` | unit | zero-width, URLs, e-mails, phones removed; flags set |
| `cache-key.test.ts` | unit | canonical prefs order-independent; version changes key |
| `search-route.int.test.ts` | integration | Turnstile fail → 403; limit → 429; cache hit → stream with `cached: true`; miss → stream runs pipeline |
| `idempotency.int.test.ts` | integration | double submit → same id |
| `intake.spec.ts` | e2e | examples, counter, preferences, vague prompt + "Search anyway", keyboard-only flow, axe |

## 12. Observability
Metrics: submits/min, validation-failure rate by field, Turnstile failures, cache-hit rate, vague-prompt rate.

## 13. Traceability matrix

| Requirement | Component(s) | Test(s) |
|---|---|---|
| FR-INT-001 | `<DescriptionForm>` | `intake.spec.ts` |
| FR-INT-002 | `SearchRequestSchema` | `schema.test.ts`, `intake.spec.ts` |
| FR-INT-003 | `examples.ts` (6+ globally neutral entries: no city, currency or country-specific wording) | `intake.spec.ts`, `examples.test.ts` |
| FR-INT-004 | `PreferencesSchema`, `<PreferencesPanel>` | `schema.test.ts`, `intake.spec.ts` |
| FR-INT-005 | schema defaults | `schema.test.ts` |
| FR-INT-006 | route steps 2–3 | `search-route.int.test.ts` |
| FR-INT-007 | `normalize()` | `normalize.test.ts` |
| FR-INT-008 | cache key + `result_cache` | `cache-key.test.ts`, `search-route.int.test.ts` |
| FR-INT-009 | `needs_detail` SSE event, `forceSearch` | `intake.spec.ts` |
| FR-INT-010 | no language filter; UI strings English | `intake.spec.ts` (Hindi example) |
| FR-INT-011 | `normalize()` removal flags + UI notice | `normalize.test.ts`, `intake.spec.ts` |
| FR-INT-012 | `sessionStorage`, no DB column | `search-route.int.test.ts` (asserts no description persisted) |
| FR-INT-013 | UUIDv7 + HMAC suffix | `search-link.test.ts` |
| FR-INT-014 | accessible form components | axe in `intake.spec.ts` |
| NFR-INT-001 | route budget §10 | `search-route.perf.test.ts` |
| NFR-INT-002 | cache-hit path | `search-route.perf.test.ts` |
| NFR-INT-003 | Turnstile managed mode | prod metric (spec 015) |
| NFR-INT-004 | lazy Turnstile, bundle budget | `next build` size check in CI |

## 14. Risks and research links
- R-09: Turnstile/Upstash limits.
- Risk: sessionStorage loses the description on a new device → shared links show results + features, not the description (by design, privacy).
