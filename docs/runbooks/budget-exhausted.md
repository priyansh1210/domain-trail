# Budget alert or free limit reached

**When:** an e-mail with `budget-<name>-80`, `budget-<name>-100`, `budget-<name>-projected` or
`db-size-mitigation` arrived (sent by the daily `cleanup` job, at most once per 6 hours per alert).

| Alert | What already happened automatically | What you can do |
|---|---|---|
| `budget-db-*`, `db-size-mitigation` (database over 300 MB of 500 MB) | clean-up keeps cached checks 14 days instead of 30 and signed-out searches 3 days instead of 7 | check Supabase → Database → table sizes; if `search_results` dominates, lower the stored results per section |
| `budget-jev-tokens-*` | at 100 % searches switch to the backup ranking rules until the month ends | look for unusual traffic (`/status`, Vercel logs); wait for the new month or approve a small credit (paid — your decision) |
| `budget-eval-tokens-*` | the weekly evaluation is skipped at 100 % | nothing; it resumes next month |
| `budget-email-*` | user e-mail is off anyway (`EMAIL_MODE=off`); owner alerts may stop at 100/day | check why so many alerts were sent |

Nothing here ever spends money by itself (constitution P1). Paid upgrades are listed in spec 017 §5.6 and need your
explicit decision.

**Check:** the next day's `daily-cleanup` run shows `alerts=0` (or only the ones you accepted) in its summary.
