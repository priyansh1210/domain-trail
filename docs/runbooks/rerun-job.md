# Re-run a job

**When:** GitHub e-mailed you that a scheduled job failed, you got a "failed twice in a row" alert, or the Status page
(`/status`) highlights a dataset as older than expected.

1. GitHub → **Actions** → pick the workflow (for example `daily-prices`) → open the failed run → read the red
   annotation at the top. It names the cause in one line, e.g. `prices: … → HTTP 503 (previous data kept)`.
2. If a source was briefly down (HTTP 5xx, timeout): click **Re-run all jobs**, or **Run workflow** on the
   workflow page. Nothing is lost by waiting either: every job keeps yesterday's data when a download fails.
3. If the run says **skipped** ("another run of this job is still going"): wait until the other run ends. A run
   that died without finishing is released automatically after 50 minutes.
4. If it says **not configured** (`SUPABASE_DB_URL is not set…`): finish `docs/setup.md` Part C step 2.
5. If a source changed its format (validation errors such as "unexpected header" or "only N entries"): the job
   wrote nothing. Open an issue with the annotation text; the parser in `jobs/<job>/index.ts` needs updating.
6. To redo work already done today (for example after fixing a parser), use **Run workflow** with **force** ticked.

**Check:** the run is green, and `/status` shows the dataset as "Up to date" (the page refreshes every 5 minutes).

Running a job on your own computer against recorded data, without touching the database:
`pnpm job refresh-prices --dry-run`.
