# Tech 011 — Accounts, Saved Searches, Watchlist and Alerts

| Field | Value |
|---|---|
| Implements | [spec.md](./spec.md) |
| Status | Approved (2026-10-03) |
| Owning packages | `apps/web/app/account`, `apps/web/app/auth`, `apps/web/app/api/me`, `jobs/watchlist`, `packages/email` |
| Last updated | 2026-10-03 |

## 1. Components and diagram

```
Browser ──(sign in)──▶ Supabase Auth (Google OAuth | GitHub OAuth | anonymous session on first Save)
   │                     └─ callback /auth/callback → @supabase/ssr sets httpOnly session cookies
   │
   ├── /account (RSC)  saved searches · watchlist · notifications · settings · export · delete
   ├── /api/me/*       route handlers using the user's session (RLS enforced; anonymous sessions allowed)
   └── /ops/saved      owner-only admin view (service role, ADMIN_USER_IDS check)

jobs/watchlist (GitHub Actions 04:00 UTC, service role)
   targets (non-anonymous users) → recheck (packages/availability) → diff → in-app notifications
   → digest e-mails only when EMAIL_MODE=on
```

**Operating mode — decided 2026-10-03: `EMAIL_MODE=off`** ($0): Google + GitHub OAuth only; notifications in-app
only; digest e-mail step skipped. `EMAIL_MODE=on` (only after the owner approves buying the site's domain) enables
Resend with a verified sending domain, magic-link sign-in via Supabase custom SMTP, and digest e-mails. Both code
paths exist; the mode is configuration only.

## 2. Stack and libraries

| Concern | Choice | Notes |
|---|---|---|
| Auth | Supabase Auth + `@supabase/ssr` | Google, GitHub OAuth; anonymous sign-ins (Turnstile-protected) for signed-out saving; magic link only when `EMAIL_MODE=on` |
| Auth e-mails | Supabase custom SMTP → Resend SMTP | Supabase's built-in e-mail sender is rate-limited for production; custom SMTP required (R-09) |
| Alert e-mails | Resend API + `react-email` templates | secondary provider: Brevo (free daily quota) when Resend's daily cap is near (R-09) |
| Tokens | HMAC-SHA256 (`UNSUBSCRIBE_SECRET`) | unsubscribe tokens without DB lookups |

## 3. Data model (DDL in spec 012)

```sql
create table profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  alerts_frequency text not null default 'daily' check (alerts_frequency in ('daily','weekly','off')),
  currency char(3) not null default 'USD',
  email_status text not null default 'ok' check (email_status in ('ok','bouncing','unsubscribed')),
  terms_version text not null, terms_accepted_at timestamptz not null,
  age_confirmed boolean not null,               -- 18+ confirmation (spec 013 FR-PRIV-008)
  created_at timestamptz not null default now()
);
create table saved_searches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (char_length(title) <= 80),
  description text check (description is null or char_length(description) between 20 and 2000),  -- null for anonymous users
  preferences jsonb not null,
  search_id uuid,                                  -- latest run
  alerts_enabled boolean not null default true,
  last_checked_at timestamptz, created_at timestamptz not null default now()
);
create table watchlist (
  user_id uuid not null references auth.users(id) on delete cascade,
  fqdn text not null,
  notify_on text[] not null default '{status_change}',
  last_status check_status, last_upfront_cents int, last_checked_at timestamptz,
  added_at timestamptz not null default now(),
  primary key (user_id, fqdn)
);
create table notifications (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('registered','available','dropping_soon','price_change')),
  fqdn text not null, payload jsonb, created_at timestamptz not null default now(),
  emailed_at timestamptz, read_at timestamptz
);
create table email_log (day date, provider text, sent int, primary key (day, provider));  -- daily cap tracking
create table anon_visitors (                       -- one row per anonymous (signed-out) saver
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()   -- bumped at most once a day when the saved list is used
);
```
Limits enforced by triggers: `saved_searches` ≤ 20 per user, `watchlist` ≤ 100 per user (raise exception → 409).

RLS (all user tables): `using (user_id = auth.uid()) with check (user_id = auth.uid())`; service role bypasses for jobs
and the admin view. `saved_searches` adds to its `with check`:
`and (description is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) = false)` — anonymous
sessions can never store a description (constitution P5). Anonymous users never get a `profiles` row.

## 4. Interfaces
Route handlers per OpenAPI (spec 009): `/api/me`, `/api/me/saved-searches`, `/api/me/watchlist`, `/api/me/export`,
`DELETE /api/me`, `/api/unsubscribe` (GET page + RFC 8058 POST). Saved-items routes accept anonymous sessions;
`DELETE /api/me` with an anonymous session deletes that anonymous user and all its saved items (FR-ACC-019).
Admin view: `/ops/saved` (RSC page, no public API).

```ts
// packages/email
sendDigest(user: { id: string; email: string }, items: NotificationItem[]): Promise<'sent'|'deferred'>;
unsubscribeToken(userId: string): string;          // base64url(userId + '.' + hmac)
verifyUnsubscribeToken(token: string): string | null;
```

## 5. Algorithms and logic

### 5.1 Sign-in flow (FR-ACC-002, 003, 015)
- "Sign in" (header, chip editing, watch alerts) → provider choice (Google / GitHub) → `redirectTo=/auth/callback?next=<current path>`;
  an intended action (e.g. edit chip) is kept in `sessionStorage` (`pendingAction`) and replayed after the callback.
- Save/star no longer needs sign-in (§5.6).
- First sign-in: if `profiles` row missing → terms dialog (checkbox + links) → insert profile with `terms_version`.
- Account linking by verified e-mail is Supabase's default for same-e-mail identities (verify setting in R-09).

### 5.2 Watchlist job diff (FR-ACC-006, 007)
```
targets = watchlist rows (all users) ∪ top-10 results of saved_searches where alerts_enabled
unique fqdns → recheck (force) with job caps
for each (user, fqdn):
   newStatus, newUpfront = result
   if last_status ≠ newStatus:
       kind = taken→'registered' | (available|likely_available|available_premium)→'available' | dropping_soon→'dropping_soon'
       insert notification
   if 'price_change' ∈ notify_on and |newUpfront − last_upfront| / last_upfront ≥ 0.10: insert notification
   update last_status, last_upfront_cents, last_checked_at
saved searches: top-10 comes from latest search_results of search_id; no Jev calls (FR: keep free)
anonymous users are excluded from targets (no alert channel; their saved names refresh on view via normal TTLs)
```

### 5.3 Digest sending (FR-ACC-008, 009, 016)
```
users with un-emailed notifications, alerts_frequency ≠ 'off', email_status = 'ok'
   weekly users only on Mondays
order users by priority (has 'registered'/'available' first)
capacity = RESEND_DAILY_CAP − email_log(today,'resend') − AUTH_EMAIL_RESERVE (20 for magic links)
send until capacity exhausted → switch to secondary provider (if configured) → else leave for tomorrow (in-app still visible)
headers: List-Unsubscribe: <https://site/api/unsubscribe?token=…>, List-Unsubscribe-Post: List-Unsubscribe=One-Click
mark notifications.emailed_at
bounces: Resend webhook → /api/webhooks/resend (signature verified) → email_status='bouncing' after 2 hard bounces
```

### 5.4 Export & delete (FR-ACC-011, 012)
- Export: server gathers `profiles`, `saved_searches`, `watchlist`, `notifications`, auth e-mail + providers → JSON download
  `domains-all-export-YYYY-MM-DD.json`.
- Delete: server (service role) → `auth.admin.deleteUser(uid)` → FK cascades delete all user rows; `searches.user_id`
  set null (anonymous snapshot keeps no personal data); sign out everywhere; confirmation screen. Backups age out within
  28 days (spec 017), stated in privacy policy.

### 5.5 Sign out everywhere (FR-ACC-013)
`supabase.auth.signOut({ scope: 'global' })`.

### 5.6 Saving while signed out (FR-ACC-017, 019)
```
first Save/star with no session:
   supabase.auth.signInAnonymously({ options: { captchaToken: turnstileToken } })   # Supabase verifies Turnstile
   → anonymous user (is_anonymous = true), session cookie set (strictly necessary; created only now)
   → insert anon_visitors(user_id)
POST /api/me/saved-searches { searchRef, title }        # description field rejected for anonymous sessions
POST /api/me/watchlist { fqdn }
limits: same triggers as accounts (20 searches, 100 names)
opening the saved list bumps anon_visitors.last_seen_at (≤ once/day)
"Delete my saved items" → DELETE /api/me → auth.admin.deleteUser(anon uid) → cascades
cleanup (spec 012): anonymous users with last_seen_at < now() − 90 days are deleted
```
The saved search keeps its `search_id`, so features and results stay viewable past the normal 7-day expiry.

### 5.7 Moving saved items into an account (FR-ACC-018)
```
signed-out saver presses Sign in → supabase.auth.linkIdentity({ provider })     # manual linking enabled
   success → same user id, now permanent: profiles row created after terms dialog; delete anon_visitors row
   identity already belongs to an existing account → sign in to that account, then
      POST /api/me/merge { anonToken }   # server verifies the anonymous JWT, then with service role:
        move saved_searches / watchlist rows anon → account (skip duplicates, respect limits)
        delete the anonymous user
```

### 5.8 Owner admin view (FR-ACC-020, 021)
- `/ops/saved` (RSC, `noindex`): allowed only when `auth.uid() ∈ ADMIN_USER_IDS` (defaults to `OWNER_USER_ID`);
  everyone else gets 404 (same guard as `/ops`, spec 015).
- Reads with the service role on the server: accounts (e-mail, provider, created, counts), saved searches (title,
  features summary, description for signed-in users), saved names and watchlists for signed-in **and** anonymous
  users (anonymous shown as `anon-<first 8 chars of id>`), plus totals per day.
- Read-only; no export button; never sent to analytics or logs.
- Disclosure: Privacy Policy line (spec 013 §5.7) — e.g. "Saved items are stored on our servers and can be viewed by
  the site operator." No in-app banner.

## 6. External services and free-tier limits

| Service | Used for | Limit | Source | Verified |
|---|---|---|---|---|
| Supabase Auth | sign-in | free plan MAU limit (50k) | supabase.com/pricing | R-09 |
| Resend | auth + alert e-mails | 3,000/month, 100/day | resend.com/pricing | R-09 |
| Brevo (optional secondary) | alert e-mails overflow | ~300/day free | brevo.com/pricing | R-09 |
| Google / GitHub OAuth | sign-in | free | provider docs | — |

## 7. Configuration and secrets

| Env var | Where | Purpose |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Vercel | client auth |
| `SUPABASE_SERVICE_ROLE_KEY` | Vercel (server only), Actions | delete account, jobs |
| `RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET` | Vercel, Actions | e-mail |
| `BREVO_API_KEY` (optional) | Actions | overflow |
| `UNSUBSCRIBE_SECRET` | Vercel, Actions | tokens |
| `RESEND_DAILY_CAP` | config | 100 |
| `EMAIL_MODE` | config | `off` (decided 2026-10-03) |
| `ADMIN_USER_IDS` | Vercel (server) | comma list of user ids allowed into `/ops/saved` (default `OWNER_USER_ID`) |
| `ANON_SAVED_RETENTION_DAYS` | config | 90 |
| `EMAIL_FROM` | config | `alerts@<site-domain>` (requires a verified sending domain; until the site has its own domain, Resend's test sender limits apply — R-09) |
| Google/GitHub OAuth client ids/secrets | Supabase dashboard | providers |

## 8. Errors, retries and fallbacks

| Failure | Response |
|---|---|
| Magic link e-mail fails | UI suggests Google/GitHub; error logged |
| Resend down | digests deferred to next run; in-app notifications remain |
| Limit trigger | 409 with message |
| Delete fails midway | transaction + retry; support contact shown |

## 9. Security and privacy controls
- Session cookies httpOnly, Secure, SameSite=Lax; CSRF: route handlers check `Origin` for state-changing requests.
- RLS on every user table; service role key never sent to the browser.
- Descriptions in `saved_searches` are personal data → exported and deleted with the account; encrypted at rest by the provider.
- Unsubscribe tokens are HMAC-signed and contain only the user id.

## 10. Performance and cost budgets
Account page: 4 small queries (RLS) < 300 ms. Watchlist job: ≤ 5,000 RDAP checks/day (cap), digests ≤ 100 e-mails/day on Resend free.

## 11. Test plan

| Test | Type | What it proves |
|---|---|---|
| `rls.int.test.ts` | integration | user A cannot read/write user B's rows (all 4 tables) |
| `limits.int.test.ts` | integration | 21st saved search / 101st watch → 409 |
| `watchlist-job.int.test.ts` | integration | status/price diffs → correct notifications |
| `digest.test.ts` | unit | grouping, priority ordering, capacity cutoff, headers |
| `unsubscribe.test.ts` | unit | token sign/verify; one-click POST |
| `export-delete.int.test.ts` | integration | export completeness; delete cascades; searches anonymized |
| `anon-save.int.test.ts` | integration | anonymous session can save names/searches; description rejected by RLS; limits apply |
| `anon-merge.int.test.ts` | integration | linkIdentity path keeps rows; existing-account path moves rows and deletes anon user |
| `anon-retention.int.test.ts` | integration | anonymous users idle > 90 days deleted with their items; active ones kept |
| `admin-view.spec.ts` | e2e | admin sees accounts + signed-out saves; non-admin and anonymous get 404 |
| `account.spec.ts` | e2e | OAuth sign-in (mocked provider), pending action replay, save, watch, settings, export, delete |

## 12. Observability
Metrics: sign-ins/day by method, saved/watch counts, notifications created, e-mails sent/deferred/bounced, unsubscribes.

## 13. Traceability matrix

| Requirement | Component(s) | Test(s) |
|---|---|---|
| FR-ACC-001 | no auth on search routes | `anonymous-search.spec.ts` |
| FR-ACC-002 | Supabase Auth providers | `account.spec.ts` |
| FR-ACC-003 | `pendingAction` replay | `account.spec.ts` |
| FR-ACC-004 | `saved_searches` + limit trigger | `limits.int.test.ts`, `account.spec.ts` |
| FR-ACC-005 | `watchlist` + limit trigger | `limits.int.test.ts` |
| FR-ACC-006 | `jobs/watchlist` | `watchlist-job.int.test.ts` |
| FR-ACC-007 | diff rules §5.2 | `watchlist-job.int.test.ts` |
| FR-ACC-008 | digest §5.3, notifications UI | `digest.test.ts`, `account.spec.ts` |
| FR-ACC-009 | unsubscribe tokens + RFC 8058 | `unsubscribe.test.ts` |
| FR-ACC-010 | `profiles` settings | `account.spec.ts` |
| FR-ACC-011 | `/api/me/export` | `export-delete.int.test.ts` |
| FR-ACC-012 | `DELETE /api/me`, backup retention | `export-delete.int.test.ts` |
| FR-ACC-013 | global sign-out | `account.spec.ts` |
| FR-ACC-014 | only digest template exists; no bulk-send code path | code review checklist + `digest.test.ts` |
| FR-ACC-015 | terms dialog, `terms_version` | `account.spec.ts` |
| FR-ACC-016 | capacity + priority | `digest.test.ts` |
| FR-ACC-017 | anonymous sessions §5.6, RLS description guard | `anon-save.int.test.ts`, `results.spec.ts` |
| FR-ACC-018 | `linkIdentity` + `/api/me/merge` §5.7 | `anon-merge.int.test.ts` |
| FR-ACC-019 | `DELETE /api/me` (anonymous), cleanup §5.6 | `anon-retention.int.test.ts`, `export-delete.int.test.ts` |
| FR-ACC-020 | `/ops/saved` + `ADMIN_USER_IDS` §5.8 | `admin-view.spec.ts` |
| FR-ACC-021 | Privacy Policy saved-items line (spec 013) | `policy-content.test.ts` |
| NFR-ACC-001 | OAuth round trip (magic link only when `EMAIL_MODE=on`) | synthetic sign-in monitor (weekly) |
| NFR-ACC-002 | RSC queries | Lighthouse CI on `/account` (authenticated fixture) |
| NFR-ACC-003 | export route | `export-delete.int.test.ts` timing |
| NFR-ACC-004 | job schedule 04:00 | job_runs |
| NFR-ACC-005 | direct profile update | `unsubscribe.test.ts` |

## 14. Risks and research links
- R-09: Resend/Brevo/Supabase Auth limits; sending-domain requirement for Resend. Owner decided (2026-10-03) to stay
  at $0 without a domain, so user e-mail stays off.
- R-09: Supabase anonymous sign-ins count toward the 50k MAU limit and need "manual identity linking" enabled for §5.7;
  CAPTCHA (Turnstile) must be on for anonymous sign-ins to prevent abuse.
