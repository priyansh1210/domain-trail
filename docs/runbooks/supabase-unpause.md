# Un-pause the free database

**When:** Supabase e-mails that the project was paused, `/api/health` shows `"db":"down"`, or every job fails with a
connection error. Free projects pause after 7 days without activity; the daily `cleanup` job normally prevents it.

1. Sign in at https://supabase.com/dashboard → the project → **Restore project** (takes a few minutes).
2. Run `daily-cleanup` and `daily-prices` by hand (GitHub → Actions → Run workflow).
3. If the jobs were not running at all, see `reenable-workflows.md`.

**Check:** `/api/health` shows `"db":"ok"`; `/status` lists the jobs with recent successes.
