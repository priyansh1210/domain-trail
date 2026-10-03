# Tech 007 — Free Domain Sources

| Field | Value |
|---|---|
| Implements | [spec.md](./spec.md) |
| Status | Approved (2026-10-03) |
| Owning packages | `packages/free-domains`, `jobs/refresh-free-providers`, `supabase/seed/free_providers.json` |
| Last updated | 2026-10-03 |

## 1. Components and diagram

```
supabase/seed/free_providers.json ──▶ free_providers (table)
jobs/refresh-free-providers (daily 02:30 UTC)
   ├─ health checks per provider
   └─ taken-list sync (where public) ──▶ free_provider_taken

pipeline (parallel with S7)
   selectProviders(profile) → providers[]
   labels = top candidates (after S6) + short personal/project variants
   for each provider: check(label) via provider.method → FreeResult
   rank → top 15 → SSE `batch` (section = 'free')
```

## 2. Stack and libraries
TypeScript; GitHub REST API (`fetch`) for repository-based providers; DoH client from `packages/availability`.

## 3. Data model

```sql
create table free_providers (
  id text primary key,                 -- 'is-a-dev'
  name text not null,                  -- 'is-a.dev'
  suffix text not null,                -- 'is-a.dev'
  kind text not null,                  -- 'subdomain_service' | 'community_registry' | 'platform_address'
  eligibility jsonb not null,          -- { requiresFlags: ['feat_developer'] | [], excludes: [...], note }
  steps text[] not null,
  wait_time text,                      -- 'usually 1–3 days (PR review)'
  official_url text not null,
  check_method text not null,          -- 'github_tree' | 'doh' | 'none'
  check_config jsonb,                  -- { repo: 'is-a-dev/register', path: 'domains', ext: '.json' }
  healthy boolean not null default true,
  health_note text,
  last_health_at timestamptz,
  reviewed_at date not null            -- human review date (NFR-FREE-003)
);
create table free_provider_taken (
  provider_id text references free_providers(id) on delete cascade,
  label text, synced_at timestamptz,
  primary key (provider_id, label)
);
```

## 4. Interfaces

```ts
export interface FreeProviderAdapter {
  method: 'github_tree' | 'doh' | 'none';
  check(label: string, p: FreeProvider): Promise<'appears_free' | 'taken' | 'not_verifiable'>;
  health(p: FreeProvider): Promise<{ healthy: boolean; note?: string }>;
  syncTaken?(p: FreeProvider): Promise<string[]>;        // for github_tree
}
export interface FreeResult {
  fqdn: string; providerId: string; status: 'appears_free'|'taken'|'not_verifiable';
  checkedAt: string; conditions: { steps: string[]; waitTime?: string; eligibility: string; url: string };
  score: number;
}
```

## 5. Algorithms and logic

### 5.1 Initial provider list (seed; each entry verified in R-08 before launch)

| id | Suffix | Kind | Eligibility (draft) | Check method |
|---|---|---|---|---|
| `is-a-dev` | `is-a.dev` | subdomain_service | developers' personal/project sites (`feat_developer` or `portfolio`/`personal_site` with dev signals) | `github_tree` on the public register repository (`domains/*.json`) |
| `js-org` | `js.org` | subdomain_service | JavaScript open-source projects only (`feat_docs` + developer) | `github_tree` / `none` (R-08) |
| `eu-org` | `eu.org` | community_registry | anyone; manual approval, can take weeks/months | `none` (not verifiable) |
| `pp-ua` | `pp.ua` | community_registry | anyone; phone (SMS) verification | `none` unless a permitted check exists (R-08) |
| `digitalplat` | provider suffixes (e.g. `us.kg`, `dpdns.org`) | community_registry | anyone; account + verification | `none` unless permitted (R-08) |
| `cf-pages` | `pages.dev` | platform_address | any static/JAMstack site | `doh` (A/AAAA/CNAME exists ⇒ taken) |
| `vercel-app` | `vercel.app` | platform_address | any web app | `doh` |
| `netlify-app` | `netlify.app` | platform_address | any static site | `doh` |
| `github-io` | `github.io` | platform_address | label must equal a free GitHub username/org | `none` (username availability not checked by us) |

The list lives in the seed file; adding a provider = add a row + (if a new method) an adapter (FR-FREE-009).

### 5.2 Provider selection (FR-FREE-002)
```
eligible = providers.filter(p => p.healthy && matches(p.eligibility, profile))
matches: all requiresFlags on (or site type in allowedSiteTypes) and no excluded flag on
platform addresses: eligible for every non-sensitive profile (hidden for adult/illegal-flagged)
```

### 5.3 Labels for free providers
- Top 20 labels from S6 ranking (already safety-filtered, FR-FREE-006), plus personal-name variants when `feat_personal`
  (`priya`, `priyasharma`, `priya-dev`) and project-name variants (`<core>-app`, `<core>-site`) for platform addresses.
- Hyphens allowed for platform addresses (common and harmless there) unless user disallowed hyphens.
- Grouping (FR-FREE-011): results whose provider `kind = 'platform_address'` are rendered in a sub-group titled
  **"Free hosting addresses"** inside the Free section, with the note "Comes with a hosting plan; check its rules
  (many free plans are non-commercial)". Other free results stay in the main Free list.

### 5.4 Checks
- `github_tree`: the daily job downloads the repository tree once (`GET /repos/{owner}/{repo}/git/trees/{branch}?recursive=1`,
  authenticated with the Actions `GITHUB_TOKEN` → 5,000 req/h), stores taken labels in `free_provider_taken`. At search
  time the check is a DB lookup (no GitHub call per search).
- `doh`: query `A` and `CNAME` for `{label}.{suffix}`; NOERROR with answers ⇒ `taken`; NXDOMAIN ⇒ `appears_free`
  (platforms may still reserve names — accuracy sampled monthly). Counted in DoH caps (spec 005).
- `none`: `not_verifiable`, shown with "Availability not verifiable — check on the provider's site".

### 5.5 Ranking (FR-FREE-007)
`score = 0.6·(relevance from spec 008 for the label) + 0.25·providerFit + 0.15·checkConfidence`
- `providerFit`: 1.0 for providers whose eligibility specifically matches (e.g. is-a.dev for developers), 0.7 platform
  addresses, 0.5 community registries with long waits.
- `checkConfidence`: appears_free 1.0, not_verifiable 0.4; taken → removed.
Top 15, max 5 per provider.

### 5.6 Health checks (FR-FREE-005)
Daily: official URL returns 2xx; for `github_tree` repo not archived and has commits/merged PRs in last 30 days;
for `doh` a known-taken sample resolves; manual `healthy=false` override supported. Two consecutive failures ⇒
`healthy=false` + alert.

## 6. External services and free-tier limits

| Service | Used for | Limit | Source | Verified |
|---|---|---|---|---|
| GitHub REST API | repository tree sync | 5,000 req/h with Actions token (1–3 calls/day used) | docs.github.com/rest | R-09 |
| DoH (spec 005) | platform address checks | shared caps | spec 005 | — |

## 7. Configuration and secrets
`GITHUB_TOKEN` (automatic in Actions). Config: `FREE_MAX_RESULTS=15`, `FREE_MAX_PER_PROVIDER=5`.

## 8. Errors, retries and fallbacks

| Failure | Response |
|---|---|
| Tree sync fails | keep previous `free_provider_taken`; `synced_at` shown as check time |
| DoH fails | `not_verifiable` for that result |
| Provider unhealthy | hidden, or marked if `health_note` says "temporarily closed" |

## 9. Security and privacy controls
- No user data sent to providers; only labels in DNS queries.
- Provider terms reviewed (R-08); providers forbidding automated checks use `none` (FR-FREE-010).

## 10. Performance and cost budgets
≤ 60 DoH queries per search for platform addresses; DB lookups for repository-based providers; section ready < 5 s.

## 11. Test plan

| Test | Type | What it proves |
|---|---|---|
| `provider-seed.test.ts` | unit | seed schema valid, required fields, reviewed_at ≤ 90 days old (warn) |
| `select-providers.test.ts` | unit | eligibility matching per profile |
| `github-tree.test.ts` | unit + MSW | tree parsing → labels; lookup |
| `doh-free.test.ts` | unit + MSW | taken/appears_free rules |
| `free-ranking.test.ts` | unit | scoring, caps per provider |
| `free-health.int.test.ts` | integration | unhealthy after 2 failures |
| `free-section.spec.ts` | e2e | conditions visible, not-verifiable label, links |

## 12. Observability
Daily provider health table on `/status` (internal view), free-result click-through by provider, not_verifiable share.

## 13. Traceability matrix

| Requirement | Component(s) | Test(s) |
|---|---|---|
| FR-FREE-001 | `free_providers` + seed | `provider-seed.test.ts` |
| FR-FREE-002 | `selectProviders` | `select-providers.test.ts` |
| FR-FREE-003 | adapters `github_tree`/`doh`/`none` | `github-tree.test.ts`, `doh-free.test.ts` |
| FR-FREE-004 | `FreeResult.conditions`, `<FreeResultCard>` | `free-section.spec.ts` |
| FR-FREE-005 | health job | `free-health.int.test.ts` |
| FR-FREE-006 | labels from S6 (already filtered) | `free-ranking.test.ts` |
| FR-FREE-007 | §5.5 | `free-ranking.test.ts` |
| FR-FREE-008 | section intro copy | `free-section.spec.ts` |
| FR-FREE-009 | seed-driven registry | `provider-seed.test.ts` |
| FR-FREE-010 | `check_method='none'` for restricted providers | `provider-seed.test.ts` (R-08 flags) |
| FR-FREE-011 | `kind='platform_address'` grouping in `<FreeSection>` | `free-section.spec.ts` |
| NFR-FREE-001 | parallel with S7 | `pipeline.perf.test.ts` |
| NFR-FREE-002 | monthly sample (with spec 005 accuracy job) | monthly report |
| NFR-FREE-003 | `reviewed_at` | `provider-seed.test.ts` |

## 14. Risks and research links
- R-08: current status, terms and permitted check methods for every provider.
- Risk: providers close or change rules → daily health checks + quarterly human review.

## 15. Implementation notes (M4, 2026-10-04)
- Check methods follow research R-08: DNS answers **every** name under vercel.app, netlify.app, github.io, is-a.dev and
  js.org, so DNS cannot check them. **is-a.dev** and **js.org** use their public GitHub lists (repository tree /
  `cnames_active.js`), fetched by the server at most every 12 hours (the M5 job will move this to
  `free_provider_taken`); **pages.dev** uses an A-record lookup; **eu.org, pp.ua, dpdns.org** an NS lookup;
  **vercel.app, netlify.app, github.io** are "not verifiable".
- DigitalPlat's **us.kg** is suspended (since 2024) and left out; its active **dpdns.org** suffix is listed.
- The provider list is `packages/free-domains/data/providers.json` (seed for `free_providers`).
