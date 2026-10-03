# Tech 009 — Results Experience (Website UI)

| Field | Value |
|---|---|
| Implements | [spec.md](./spec.md) |
| Status | Approved (2026-10-03) |
| Owning packages | `apps/web` |
| API contract | [contracts/http-api.openapi.yaml](./contracts/http-api.openapi.yaml) |
| Last updated | 2026-10-03 |

## 1. Components and diagram

```
apps/web/app
  (marketing)/page.tsx            Home            → <DescriptionForm> (spec 001)
  (marketing)/how-it-works/       static MDX
  (marketing)/privacy/, terms/    static MDX (content from spec 013)
  status/page.tsx                 RSC, reads job_runs + data ages (revalidate 300 s)
  s/[ref]/page.tsx                Results (client-heavy)
      <ResultsProvider>           Zustand store: profile, results by fqdn, sections, filters, stream state
        <ProgressStages/>          stage indicator
        <FeatureChips/>            spec 003 (edit → /refine, signed-in only; read-only + "Sign in to edit" otherwise)
        <FilterBar>                <PriceRangeFilter/> <BasisToggle/> <CurrencySelect/> <SortSelect/>
        <SectionTabs/>             tabs below 768 px; desktop shows all sections as one vertical list
        <Section tier=…>           <ResultCard/>×n, <ShowMore/>, <FindMoreInRange/>, <EmptyState/>
        <Unpriced/>                (<DroppingSoon/> added in phase 2)
        <LiveAnnouncer/>           aria-live polite, throttled 5 s
  account/…                       spec 011
  api/…                           route handlers (OpenAPI)
```

## 2. Stack and libraries

| Concern | Choice | Notes |
|---|---|---|
| Framework | Next.js App Router, React Server Components for static/marketing pages | |
| Styling | Tailwind CSS + shadcn/ui (Radix) | accessible primitives (Tabs, Slider, Toast, Dialog, Tooltip) |
| Client state | Zustand | results map keyed by fqdn; derived selectors per section |
| URL state | `nuqs` | `?min&max&basis&cur&sort&tab` |
| Streaming client | `@microsoft/fetch-event-source` | POST + SSE, retries, abort |
| Theme | `next-themes` | system preference (FR-UX-015) |
| Strings | `apps/web/messages/en.json` + tiny `t()` helper | ready for `next-intl` later (FR-UX-019) |
| Icons | `lucide-react` | |
| Analytics | Cloudflare Web Analytics beacon | cookieless |
| SEO | Next metadata API; `robots: noindex` on `/s/*`, `/account/*` | FR-UX-016 |

## 3. Data model (client)

```ts
interface ResultVM {
  fqdn: string; label: string; tld: string;
  section: 'free'|'budget'|'mid'|'premium'|'dropping'|'unpriced';
  status: CheckStatus | 'appears_free' | 'not_verifiable';
  checkedAt: string;
  price?: { upfrontUsdCents: number; renewUsdCents: number; minYears: number; source: string; buyUrl: string;
            premium?: boolean; premiumPossible?: boolean; renewWarning?: boolean };
  restriction?: string;
  free?: { providerId: string; conditions: {...} };
  score: number; reasons: Array<{ id: string; text: string }>;
  strategy: string;
}
```

## 4. Interfaces

### 4.1 Stream events (POST `/api/search`, `/api/search/{ref}/more`, `/api/search/{ref}/refine`)

| Event | Data | When |
|---|---|---|
| `search_created` | `{ searchId, ref, cached }` | first |
| `progress` | `{ stage: 'features'|'names'|'ranking'|'availability'|'pricing', pct }` | stage changes |
| `features` | `SiteProfile` (spec 003) | after S1 |
| `needs_detail` | `{ hints: string[] }` | clarity too low (stream ends) |
| `refused` | `{ reason: 'safety' }` | safety gate (stream ends) |
| `degraded` | `{ reason: 'jev_unavailable'|'budget' }` | fallback used |
| `batch` | `{ results: ResultVM[] }` | as availability confirms (~10 per batch) |
| `update` | `{ fqdn, status, checkedAt, price? }` | background re-checks |
| `notice` | `{ code: 'avl_paused'|'stale_prices'|'low_supply', message }` | as needed |
| `done` | `{ counts: Record<section, number>, durationMs, dataAgeHours }` | end |
| `error` | `{ code, message }` | fatal error (stream ends) |

Heartbeat comment `: ping` every 10 s to keep proxies from closing the stream.

### 4.2 HTTP API
Full contract in `contracts/http-api.openapi.yaml`. Summary:

| Method | Path | Purpose | Auth |
|---|---|---|---|
| POST | `/api/search` | start search, returns event stream | none (Turnstile) |
| GET | `/api/search/{ref}` | snapshot JSON (shared links, reload) | none |
| POST | `/api/search/{ref}/more` | more results in price band, stream | none (Turnstile) |
| POST | `/api/search/{ref}/refine` | re-rank with edited features, stream | session, non-anonymous (+ Turnstile) |
| POST | `/api/domains/{fqdn}/recheck` | fresh availability check | none (rate-limited) |
| POST | `/api/feedback` | thumbs up/down | none (rate-limited) |
| POST | `/api/events` | anonymous action events (buy_click, copy) | none (rate-limited) |
| GET | `/api/status` | data freshness + health | none |
| GET/PATCH | `/api/me` | profile & settings | session |
| GET/POST | `/api/me/saved-searches` | list/create | session (anonymous session allowed) |
| DELETE | `/api/me/saved-searches/{id}` | delete | session (anonymous session allowed) |
| GET/POST | `/api/me/watchlist` | list/add (saved names) | session (anonymous session allowed) |
| DELETE | `/api/me/watchlist/{fqdn}` | remove | session (anonymous session allowed) |
| GET | `/api/me/export` | JSON export of all user data | session |
| DELETE | `/api/me` | delete account + data | session |
| GET | `/api/unsubscribe` | one-click unsubscribe (token) | token |

## 5. Algorithms and logic
- **No layout shift (NFR-UX-002):** each section reserves space for its first page with skeleton cards of fixed height;
  results fill skeleton slots in rank order; later, higher-ranked arrivals are inserted with a subtle highlight but
  only *above the fold on first paint*; after the user scrolls, new items append to avoid jumping (tracked via
  IntersectionObserver).
- **Throttled announcements (US-5):** `LiveAnnouncer` accumulates counts and announces every ≥ 5 s.
- **Reconnect:** `fetch-event-source` retry up to 3 times with the same `clientRequestId`; if the server reports the
  search done, fall back to `GET /api/search/{ref}`.
- **Shared links (FR-UX-006):** `/s/{ref}` without sessionStorage → load snapshot; any result whose check expired is
  re-checked by calling `POST /api/domains/{fqdn}/recheck` for the top 10 visible (rate-limited), others marked
  "checked X h ago".
- **Expired results:** snapshot 404 with `code: 'expired'` → expired state (spec edge case).
- **Sorting (FR-UX-018):** client-side comparator on the store.
- **Section layout (FR-UX-003):** ≥ 768 px: all sections stacked vertically with a sticky in-page section menu;
  < 768 px: Radix `Tabs`, one tab per section with its count (`?tab=` in the URL).
- **Save without an account (FR-UX-020):** the first Save/star by a signed-out visitor calls
  `supabase.auth.signInAnonymously({ options: { captchaToken } })` (Turnstile token), which sets the anonymous-session
  cookie, then posts to `/api/me/watchlist` or `/api/me/saved-searches` (spec 011 §5.6). No dialog is shown.

## 6. External services and free-tier limits
Cloudflare Web Analytics (free, no cookies). Everything else via API routes.

## 7. Configuration and secrets
`NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_CF_ANALYTICS_TOKEN`, `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, `SEARCH_LINK_SECRET` (server).

## 8. Errors, retries and fallbacks

| Failure | Response |
|---|---|
| Stream error before `features` | error card with "Try again" (same description from sessionStorage) |
| Stream error after partial results | keep results, banner "Some results could not be loaded" |
| Snapshot 404 | expired state |
| Recheck 429 | toast "Please wait a moment" |

## 9. Security and privacy controls
- CSP (spec 013) allows only self, Turnstile, Cloudflare analytics, Sentry.
- Buy links: `target="_blank" rel="noopener noreferrer"`, domain names rendered as text (never HTML).
- Description is never put in URLs, analytics or logs.

## 10. Performance and cost budgets
- Home: RSC + small client island (form); fonts via `next/font` (self-hosted, subset).
- Results: JS < 250 KB gz; virtualized lists not needed for ≤ 300 cards; images none (icons SVG).
- Status page revalidated every 5 min (ISR) to avoid DB hits per view.

## 11. Test plan

| Test | Type | What it proves |
|---|---|---|
| `stream-client.test.ts` | unit | event parsing, reconnect, fallback to snapshot |
| `store.test.ts` | unit | section selectors, filters, sorting |
| `result-card.test.tsx` | component (Vitest + Testing Library) | all fields/badges/actions render |
| `results.spec.ts` | e2e | progress stages, streaming fill, card content, buy/copy/save/recheck/thumbs |
| `share.spec.ts` | e2e | shared link without description, expired state |
| `a11y.spec.ts` | e2e | axe on every page, keyboard-only journey, live-region throttle |
| `responsive.spec.ts` | e2e | 360 px, tablet, desktop snapshots |
| `seo.spec.ts` | e2e | noindex on /s/*, titles on marketing pages |
| Lighthouse CI | perf | LCP/CLS/INP budgets on preview deployments |

## 12. Observability
Web vitals (Cloudflare analytics + `web-vitals` to Sentry performance sampling 10%), stream error rate, reconnect rate,
action events per position.

## 13. Traceability matrix

| Requirement | Component(s) | Test(s) |
|---|---|---|
| FR-UX-001 | Home page | `intake.spec.ts`, `seo.spec.ts` |
| FR-UX-002 | Results layout | `results.spec.ts` |
| FR-UX-003 | vertical list ≥ 768 px, `<SectionTabs>` below, counts | `responsive.spec.ts` |
| FR-UX-004 | `<ResultCard>` | `result-card.test.tsx`, `results.spec.ts` |
| FR-UX-005 | `<ProgressStages>`, skeleton slots | `results.spec.ts`, Lighthouse CLS |
| FR-UX-006 | `/s/[ref]` snapshot | `share.spec.ts` |
| FR-UX-007 | `<ShowMore>`, `<FindMoreInRange>` | `find-more.spec.ts` |
| FR-UX-008 | `<EmptyState>` | `results.spec.ts` |
| FR-UX-009 | banners from `degraded`/`notice`/`refused` | `results.spec.ts` |
| FR-UX-010 | how-it-works MDX | `seo.spec.ts` |
| FR-UX-011 | `status/page.tsx`, `/api/status` | `status.spec.ts` |
| FR-UX-012 | privacy/terms MDX, footer | `seo.spec.ts` |
| FR-UX-013 | a11y patterns, `LiveAnnouncer` | `a11y.spec.ts` |
| FR-UX-014 | responsive CSS | `responsive.spec.ts` |
| FR-UX-015 | `next-themes` | `responsive.spec.ts` (dark snapshot) |
| FR-UX-016 | metadata/robots | `seo.spec.ts` |
| FR-UX-017 | `<Disclaimer>` | `results.spec.ts` |
| FR-UX-018 | sort comparator | `store.test.ts` |
| FR-UX-019 | `messages/en.json` + `t()` | lint rule: no raw strings in JSX (eslint-plugin-i18next, warn) |
| FR-UX-020 | anonymous session on first Save, `/api/me/*` | `results.spec.ts` (save while signed out), `anon-save.int.test.ts` |
| NFR-UX-001 | RSC home, self-hosted fonts | Lighthouse CI (LCP) |
| NFR-UX-002 | skeleton slots, append-after-scroll | Lighthouse CI (CLS) |
| NFR-UX-003 | small client islands, memoized selectors | Lighthouse CI / web-vitals (INP) |
| NFR-UX-004 | axe | `a11y.spec.ts` |
| NFR-UX-005 | bundle budget | `next build` size check |

## 14. Risks and research links
- R-09: streaming duration limits on Vercel Hobby functions (need ≥ 25 s).
