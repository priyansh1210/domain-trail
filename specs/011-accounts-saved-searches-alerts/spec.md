# Spec 011 — Accounts, Saved Searches, Watchlist and Alerts

| Field | Value |
|---|---|
| Spec ID | 011 |
| Area code | `ACC` |
| Status | Approved (2026-10-03) |
| Depends on | 005, 009, 010, 012, 013 |
| Tech file | [tech.md](./tech.md) |
| Last updated | 2026-10-03 |

## 1. Why (problem and value)
Choosing a domain often takes days: people discuss options with partners, wait for budget, or hope a name
becomes available. Without accounts, all that work is lost when the tab closes. The owner chose **optional**
accounts: searching stays anonymous and frictionless, while people who want continuity can sign in to save
searches, watch names and receive alerts — which also puts the daily data refresh to direct use for them.

## 2. What (scope summary)
- Sign in with Google or GitHub (no password). E-mail-link sign-in waits until the site has its own domain.
- **Saved searches:** keep a search (with its description) and re-open or re-run it later.
- **Saving without an account:** signed-out visitors can save names and searches too; these are stored on our
  server under a random browser identifier (no description text) and move into an account if the visitor signs in.
- **Watchlist:** follow specific names; each is re-checked daily.
- **Alerts:** a daily (or weekly) digest in the app's notification list — registered, became available, price
  changed (dropping soon from phase 2). Digest e-mails are added only once the site has its own domain. No marketing
  e-mails, ever.
- **Account settings:** alert frequency, currency, export my data, delete my account.
- **Admin view:** a private page where the owner can see accounts, saved items and watchlists.

## 3. User stories and acceptance criteria

### US-1 Sign in without a password
As a visitor, I want to sign in quickly.
- **Given** I click "Sign in" **When** I choose Google or GitHub and approve **Then** I am signed in and returned to the page I was on.

### US-2 Save from the results page
As a visitor, I want to save a search I like.
- **Given** results **When** I click "Save search" **Then** the search appears in my saved list with a title I can edit — in my account if I
  am signed in, otherwise under my browser's identifier, and it moves into my account when I sign in.

### US-3 Watch a name
As a signed-in user, I want to watch `sunnycrust.shop`.
- **Given** a result card **When** I press the star **Then** the name is in my watchlist with its current status and price.

### US-4 Get alerted
As a watcher, I want to know when something changes.
- **Given** a watched name was registered yesterday **When** today's alert job runs **Then** my in-app notifications show one digest listing it
  (and an e-mail, once e-mail is enabled).

### US-5 Stop e-mails easily (once e-mail is enabled)
As a user, I want to stop e-mails with one click.
- **Given** any alert e-mail **When** I click "Unsubscribe" **Then** alerts stop immediately, without signing in.

### US-6 Control my data
As a user, I want to download or delete everything.
- **Given** account settings **When** I click "Export my data" **Then** I download a file with all my personal data;
  **When** I click "Delete my account" and confirm **Then** my account and personal data are deleted immediately.

### US-7 Owner admin view
As the owner, I want to see how people use saving and watching.
- **Given** I am signed in with an owner account **When** I open the admin view **Then** I see accounts, saved searches, saved names
  and watchlists (signed-in and signed-out); nobody else can open this view.

## 4. Functional requirements

| ID | Requirement | Priority |
|---|---|---|
| FR-ACC-001 | Searching MUST never require an account. | MUST |
| FR-ACC-002 | Users MUST be able to sign in with Google or GitHub. Sign-in by e-mail link is not offered until the owner approves the site's own domain (decision 3). No passwords are stored by us. | MUST |
| FR-ACC-003 | After sign-in, users MUST return to the page and complete the action they started (e.g. saving). | MUST |
| FR-ACC-004 | Signed-in users MUST be able to save up to 20 searches (description, preferences, title) and re-open or re-run them. | MUST |
| FR-ACC-005 | Signed-in users MUST be able to watch up to 100 domain names. | MUST |
| FR-ACC-006 | Watched names and the top 10 results of saved searches with alerts on MUST be re-checked daily. | MUST |
| FR-ACC-007 | Changes that trigger alerts: a name became registered, became available, or its upfront price changed by 10% or more; "entered dropping soon" is added in phase 2. | MUST |
| FR-ACC-008 | Alerts MUST appear in an in-app notification list covering the last 30 days, grouped as one digest per user per day (default) or per week, only when there are changes. When e-mail is enabled, the digest MUST also be sent by e-mail. | MUST |
| FR-ACC-009 | Every e-mail MUST include a one-click unsubscribe that works without signing in. | MUST |
| FR-ACC-010 | Users MUST be able to change alert frequency (daily/weekly/off) and display currency. | MUST |
| FR-ACC-011 | Users MUST be able to export all their personal data in a machine-readable file. | MUST |
| FR-ACC-012 | Users MUST be able to delete their account; personal data MUST be deleted immediately from live systems and disappear from backups within the backup retention period. | MUST |
| FR-ACC-013 | Users MUST be able to sign out, including from all devices. | MUST |
| FR-ACC-014 | The system MUST NOT send marketing or promotional e-mails. | MUST |
| FR-ACC-015 | Users MUST accept the Terms and Privacy Policy at first sign-in; the acceptance time and policy version MUST be recorded. | MUST |
| FR-ACC-016 | When the daily e-mail capacity is nearly used up, alerts MUST still appear in-app, and e-mails MUST be prioritised (registered/available first). | MUST |
| FR-ACC-017 | Signed-out visitors MUST be able to save searches (features, preferences and results — never the description text) and names without signing in. Saved items MUST be stored on the server, linked to a random, unguessable identifier kept in the visitor's browser, with the same limits as accounts (20 searches, 100 names). | MUST |
| FR-ACC-018 | When a signed-out visitor signs in, their saved items SHOULD move into their account. | SHOULD |
| FR-ACC-019 | Signed-out visitors MUST be able to delete their saved items themselves; saved items unused for 90 days MUST be deleted automatically (spec 012). | MUST |
| FR-ACC-020 | The owner MUST have a private admin view of accounts, saved searches, saved names and watchlists (signed-in and signed-out). Only accounts on the owner's admin list MAY open it. | MUST |
| FR-ACC-021 | The Privacy Policy MUST state that saved items are stored on the server and can be seen by the site operator (spec 013). No in-app notice beyond the policy is required. | MUST |

## 5. Non-functional requirements

| ID | Requirement | Target |
|---|---|---|
| NFR-ACC-001 | Sign-in round trip (Google/GitHub) | < 10 s p95 (e-mail-link delivery < 60 s p95 once enabled) |
| NFR-ACC-002 | Account page load | < 1.5 s p95 |
| NFR-ACC-003 | Data export generation | < 5 s |
| NFR-ACC-004 | Alert digest available after the daily job | before 06:00 UTC |
| NFR-ACC-005 | Unsubscribe effective | immediately |

## 6. Data used (conceptual)
E-mail address, sign-in provider, display name (optional), settings, saved searches (including description text,
by the user's choice), watched names with last-known status/price, notifications, policy acceptance record.
Signed-out visitors: a random browser identifier and their saved names/searches (without description text).

## 7. Edge cases and failure behavior

| Situation | Expected behavior |
|---|---|
| User exceeds limits (20 searches / 100 names) | Clear message; offer to remove old items. |
| Same e-mail signs in with Google and e-mail link | Same account (linked by verified e-mail). |
| E-mail bounces repeatedly | Alerts paused; banner in account asks to update e-mail. |
| Watched name becomes available again | Alert "now available" with a Buy link. |
| Deleted account's shared result links | Still work (they are anonymous snapshots without personal data) until they expire. |

## 8. Out of scope
- Teams or shared accounts.
- Paid plans.
- Push notifications / SMS.
- Password-based sign-in.

## 9. Success metrics
- ≥ 10% of searchers sign in within the first 3 months.
- ≥ 30% of signed-in users watch at least one name.
- Unsubscribe rate < 5% per month.

## 10. Owner decisions (2026-10-03)
The reviewer questions of the draft were answered by the owner; the answers are applied above.

| Question | Decision |
|---|---|
| 1. Default alert frequency | Daily (FR-ACC-008). |
| 2. Higher search limits for signed-in users? | Yes: 60 searches/day signed-in vs 30/day anonymous (spec 014 FR-ABU-002). The owner chose this when the answers to 011 and 014 conflicted. |
| 3. E-mail features: stay at $0 or buy a domain? | Option (a): stay at $0. Google/GitHub sign-in only, alerts in the app only (FR-ACC-002, FR-ACC-008). |
| Extra (from 009) | Signed-out saving goes to the server, the owner has an admin view, and the Privacy Policy discloses it (FR-ACC-017…021). |
