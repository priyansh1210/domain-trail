# Tech 005 — Domain Availability Checking

| Field | Value |
|---|---|
| Implements | [spec.md](./spec.md) |
| Status | Approved (2026-10-03) |
| Owning packages | `packages/availability` |
| Last updated | 2026-10-03 |

## 1. Components and diagram

```
checkMany(fqdns[], ctx)  ── emits CheckResult as each finishes
   │
   ├─1─ cache.getMany(fqdns)            SELECT … FROM domain_checks WHERE fqdn = ANY($1) AND expires_at > now()
   │        fresh → emit
   │
   ├─2─ doh.nsBatch(misses)             Cloudflare DoH (JSON) → Google DoH fallback
   │        NOERROR + NS answer/authority → taken (method='dns')
   │        NXDOMAIN or NOERROR/empty or error or tld.dns_wildcard → step 3
   │
   ├─3─ rdap.lookup(fqdn)               base URL from IANA bootstrap (tlds.rdap_base_url)
   │        404 → available (method='rdap')
   │        200 → taken | dropping_soon (status contains 'pending delete' / 'redemption period')
   │        429/5xx/timeout → unknown
   │        tld.has_rdap=false → NXDOMAIN ⇒ likely_available (method='dns')
   │
   ├─4─ premium.check(shortlist)        spec 006 adapters (only available + tlds.has_premium_names)
   │        premium → available_premium + price
   │
   └─5─ cache.upsertMany(results)       one INSERT … ON CONFLICT (fqdn) DO UPDATE
```

## 2. Stack and libraries

| Concern | Choice | Notes |
|---|---|---|
| HTTP | native `fetch`, `AbortController` | |
| Concurrency | `p-limit` per host + global | |
| Rate limiting per RDAP host | in-memory token bucket (per instance) + adaptive backoff | |
| Global daily caps | Upstash counters `avl:rdap:{yyyymmdd}`, `avl:doh:{yyyymmdd}` (1 INCRBY per search) | |
| Domain parsing | our own: `label.tld` where tld ∈ `tlds` (supports 2-level like `co.in`) | no PSL dependency needed because we build FQDNs ourselves |

## 3. Data model (full DDL in spec 012)

```sql
create type check_status as enum
  ('available','likely_available','available_premium','taken','dropping_soon','unknown');

create table domain_checks (
  fqdn              text primary key,          -- 'sunnycrust.shop'
  tld               text not null references tlds(tld),
  status            check_status not null,
  method            text not null,             -- 'dns' | 'rdap' | 'registrar' | 'nrd'
  premium_price_cents int,                     -- when available_premium
  premium_currency  char(3),
  premium_source    text,                      -- adapter id
  drop_window_start date, drop_window_end date,
  checked_at        timestamptz not null,
  expires_at        timestamptz not null
);
create index on domain_checks (expires_at);
create index on domain_checks (tld, status);
```
`tlds` columns used: `rdap_base_url`, `has_rdap`, `dns_wildcard`, `has_premium_names`, `rdap_rps` (override).

## 4. Interfaces

```ts
export type CheckStatus = 'available'|'likely_available'|'available_premium'|'taken'|'dropping_soon'|'unknown';
export interface CheckResult {
  fqdn: string; status: CheckStatus; method: 'dns'|'rdap'|'registrar'|'nrd'|'cache';
  checkedAt: string; expiresAt: string;
  premium?: { priceCents: number; currency: string; source: string };
  dropWindow?: { start: string; end: string };
}
export function checkMany(fqdns: string[], ctx: { deadlineMs: number; searchId: string;
  onResult: (r: CheckResult) => void; force?: boolean }): Promise<CheckResult[]>;
export function recheckOne(fqdn: string): Promise<CheckResult>;   // force = true, bypasses cache
```
HTTP: `POST /api/domains/{fqdn}/recheck` (spec 009) → `CheckResult`. Limited to 10/min per user/IP (spec 014).

## 5. Algorithms and logic

### 5.1 DoH NS check
```
GET https://cloudflare-dns.com/dns-query?name={fqdn}&type=NS   accept: application/dns-json
  Status 0 and (Answer has type 2 for fqdn or Authority has NS for fqdn)   → taken
  Status 3 (NXDOMAIN)                                                     → rdap
  else / error / timeout 1,200 ms → retry once on https://dns.google/resolve?name={fqdn}&type=NS → same rules
Concurrency: 25 global per search. Skip DoH if tlds.dns_wildcard.
```
Note: `Authority` SOA of the TLD with Status 0 but no NS for the fqdn = registered-but-undelegated is rare; treat as `rdap`.

### 5.2 RDAP
```
url = tlds.rdap_base_url + 'domain/' + fqdn         (base ends with '/')
headers: accept: application/rdap+json, user-agent: 'domains-all/1.0 (+https://<site>/about#bots)'
timeout 3,000 ms
404                     → available
200 → parse json.status[] (lowercase):
        includes 'pending delete' or 'redemption period' → dropping_soon
             drop window = events[eventAction='expiration'] + registry grace (config per TLD, default 30–35 d)
        else → taken
429 → honour Retry-After (≤ 5 s else unknown); halve host rate for 10 min
5xx/timeout → one retry after 500 ms, then unknown
400/other → unknown (log)
```
Per-host token bucket: default 5 req/s, burst 5, concurrency 4 (`tlds.rdap_rps` overrides, e.g. lower for small
ccTLD registries). Global per search ≤ 120 RDAP requests; remaining → `unknown` (re-checked later if user re-checks).

### 5.3 Freshness (TTL) and ranking effect
| Status | TTL | Rank effect (spec 008) |
|---|---|---|
| available | 6 h | none |
| likely_available | 6 h | −0.10 |
| available_premium | 24 h | none (priced by premium price) |
| taken | 7 d | not shown |
| dropping_soon | 24 h | shown in a separate list from phase 2; in phase 1 treated like `taken` in the UI |
| unknown | 1 h | −0.20, shown last with "Unconfirmed" |

Cached `available` older than 30 min is re-verified by RDAP *in the background of the stream* if the result will
be shown in the top 20 (cheap insurance; counted in the RDAP cap).

### 5.4 NRD invalidation (with spec 010)
Daily job: for each NRD fqdn present in `domain_checks` with status in (available, likely_available, available_premium):
`update … set status='taken', method='nrd', checked_at=now(), expires_at=now()+7d`.

### 5.5 Wildcard and RDAP-capability detection (daily, spec 010)
- For each TLD in our pool: query DoH for `{random 20 letters}.{tld}` → NOERROR ⇒ `dns_wildcard = true`.
- `has_rdap` / `rdap_base_url` from the IANA bootstrap file.

### 5.6 Accuracy measurement (FR-AVL-012)
Monthly GitHub Action `monthly-availability-accuracy.yml`: sample 100 `available` + 100 `taken` from the last 7 days
(stratified by TLD) → check with the Porkbun `checkDomain` API (free account key; 1 check per 10 s ⇒ ~35 min) →
write `quality_reports(kind='availability', precision, …)` and flag TLDs with errors (e.g. reserved names) into
`tlds.availability_notes`.

## 6. External services and free-tier limits

| Service | Used for | Limit | Source | Verified |
|---|---|---|---|---|
| Cloudflare DoH (`cloudflare-dns.com/dns-query`) | NS pre-check | free public resolver; no published per-client quota — we cap ≤ 400 queries/search, 25 concurrent | developers.cloudflare.com/1.1.1.1 | R-03 |
| Google Public DNS JSON API (`dns.google/resolve`) | fallback | free; fair-use | developers.google.com/speed/public-dns | R-03 |
| RDAP servers (per registry) via IANA bootstrap | authoritative | per-registry limits, mostly unpublished — default 5 req/s/host | data.iana.org/rdap/dns.json | R-03 |
| Porkbun `checkDomain` | monthly accuracy sample | 1 check / 10 s; free API key | porkbun.com/api/json/v3/documentation | R-05 |

## 7. Configuration and secrets

| Env var / config | Purpose | Default |
|---|---|---|
| `AVL_TTL_*` | TTLs per status | §5.3 |
| `AVL_RDAP_DEFAULT_RPS`, `AVL_RDAP_MAX_PER_SEARCH` | politeness | 5, 120 |
| `AVL_DOH_MAX_PER_SEARCH`, `AVL_DOH_CONCURRENCY` | caps | 400, 25 |
| `AVL_RDAP_DAILY_CAP`, `AVL_DOH_DAILY_CAP` | global caps | 60,000 / 150,000 |
| `AVL_USER_AGENT_URL` | contact URL in UA | site `/about#bots` |
| `PORKBUN_API_KEY`, `PORKBUN_SECRET_KEY` | GitHub Actions only (accuracy job, premium adapter) | — |

## 8. Errors, retries and fallbacks

| Failure | Response |
|---|---|
| DoH provider down | second provider; if both fail → RDAP directly |
| RDAP host 429 storm | adaptive halving; results `unknown`; alert if > 20% unknown in 1 h |
| Bootstrap missing TLD | `has_rdap=false` → likely_available path |
| Daily caps reached | cache-only mode; SSE `notice` event "Availability checks paused until 00:00 UTC" |
| Supabase down | checks still run; no cache read/write |

## 9. Security and privacy controls
- Only domain names leave our servers; no user data in DNS/RDAP requests.
- Honest User-Agent with contact URL (good citizenship).
- RDAP responses are parsed defensively (size limit 256 KB, JSON only, no HTML rendering of fields).
- We never store registrant data from RDAP (only status/events).

## 10. Performance and cost budgets
Typical uncached search: ~250 FQDNs → cache hits ~30% → ~175 DoH (≈ 1–2 s at concurrency 25) → ~40 NXDOMAIN → RDAP
(≈ 2–4 s across hosts) → ≤ 10 premium checks (only if adapter configured). Target: first confirmed batch < 3 s after S6.

## 11. Test plan

| Test | Type | What it proves |
|---|---|---|
| `doh.test.ts` | unit + MSW | NOERROR/NXDOMAIN/authority parsing, fallback provider, wildcard skip |
| `rdap.test.ts` | unit + MSW | 404/200/pending delete/429 Retry-After/5xx retry/timeouts |
| `rate-limit.test.ts` | unit | token bucket, adaptive halving, per-search caps |
| `cache.test.ts` | integration (local Supabase) | TTLs, batch upsert, expired re-check |
| `check-many.int.test.ts` | integration | ordering of steps, streaming callback, deadline → unknown |
| `nrd-invalidate.test.ts` | integration | available → taken |
| `recheck.spec.ts` | e2e | button updates status + time |
| monthly accuracy job | eval | NFR-AVL-001/002 |

## 12. Observability
Per search: counts by method/status, cache hit rate, RDAP 429s by host, p95 latency per host. Alerts: unknown-rate > 20%/h,
any host 429-rate > 30%, accuracy report below target (spec 015).

## 13. Traceability matrix

| Requirement | Component(s) | Test(s) |
|---|---|---|
| FR-AVL-001 | `rdap.ts`, status rules | `rdap.test.ts`, `check-many.int.test.ts` |
| FR-AVL-002 | `doh.ts` | `doh.test.ts` |
| FR-AVL-003 | `check_status` enum, `CheckResult` | `check-many.int.test.ts` |
| FR-AVL-004 | `checkedAt` → UI (spec 009) | `results.spec.ts` |
| FR-AVL-005 | TTL config, `cache.ts` | `cache.test.ts` |
| FR-AVL-006 | `onResult` streaming | `check-many.int.test.ts`, `streaming.spec.ts` |
| FR-AVL-007 | token buckets, Retry-After | `rate-limit.test.ts`, `rdap.test.ts` |
| FR-AVL-008 | likely_available/unknown paths | `rdap.test.ts` |
| FR-AVL-009 | `domain_checks` shared cache | `cache.test.ts` |
| FR-AVL-010 | `jobs/nrd-ingest` (spec 010) | `nrd-invalidate.test.ts` |
| FR-AVL-011 | `premium.check` (spec 006) | `premium-adapter.test.ts` |
| FR-AVL-012 | monthly accuracy workflow | workflow report |
| FR-AVL-013 | Upstash daily counters | `caps.test.ts` |
| FR-AVL-014 | `recheckOne`, route | `recheck.spec.ts` |
| FR-AVL-015 | dropping_soon + drop window (UI list in phase 2) | `rdap.test.ts`, `results.spec.ts` (phase 2) |
| NFR-AVL-001 | accuracy job ("available" sample) | monthly report |
| NFR-AVL-002 | accuracy job ("taken" sample) | monthly report |
| NFR-AVL-003 | concurrency settings | `check-many.perf.test.ts` (mocked latencies) |
| NFR-AVL-004 | `recheckOne` | `recheck.spec.ts` |
| NFR-AVL-005 | shared cache | prod metric |
| NFR-AVL-006 | per-host bucket | `rate-limit.test.ts` |

## 14. Risks and research links
- R-03: RDAP limits for Verisign (.com/.net), PIR (.org), Identity Digital, Google Registry, CentralNic, Radix; ccTLDs without RDAP; DoH fair use.
- Risk: reserved names return 404 → mitigated by accuracy sampling and per-TLD notes.

## 15. Implementation notes (M4, 2026-10-04)
- **Real checks in mock mode.** DoH and RDAP are free and keyless, so they run for real whenever
  `PUBLIC_DATA_MODE=live` (the default), also while `MOCK_EXTERNALS=1`; tests and CI use recorded answers
  (`PUBLIC_DATA_MODE=fixture`, `fixtureFetch`). Reason: P3 — a simulated "available" on the public site would be dishonest.
- **Directory and wildcards without the daily job.** The IANA directory is a committed snapshot refreshed in memory every
  12 hours per server instance; wildcard extensions are detected lazily (one random-label DoH query per extension per
  12 hours). The M5 daily job (spec 010) will write both to `tlds`.
- **Order and deadline.** A search checks up to 250 pairs within 12 seconds (`availability.searchDeadlineMs`). Names
  are queued in score order, so with 5 requests/second per registry the best ~60 per registry are confirmed first; the
  rest are "unknown" (late answers still fill the cache). Each name reserves its RDAP slot before waiting, so parallel
  names never exceed the 120-per-search cap.
- **No RDAP** for .io, .co, .us, .me, .de, .jp and others (research R-03): NXDOMAIN there gives "likely available".
- The `domain_checks` cache adds unknown extensions to `tlds` on first use until the M5 registry job exists.
- **Accuracy check** (§5.6): `pnpm eval:availability` / `monthly-availability-accuracy.yml` samples names generated for
  the golden examples (stratified by extension) rather than the last 7 days of `domain_checks`, so it works before
  Supabase is in use; it uses Porkbun's bulk `checkDomain` (25 per call, 200 per minute).
- **Hard time limits (2026-10-04):** on the production host some requests stayed open after their abort signal, and a
  search never sent `done`. Every outbound request now goes through `timedFetch` (`@domains-all/config/net`), which
  settles at its limit whatever the runtime does; the free-name stage, each free check (4 s) and the shared-cache
  calls (1.5 s read, 2 s write) are bounded with `within`.
