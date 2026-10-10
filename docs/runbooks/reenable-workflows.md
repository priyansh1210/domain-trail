# Re-enable scheduled workflows

**When:** GitHub sends an e-mail saying scheduled workflows were disabled, or no job has run for days. GitHub turns
off schedules in public repositories after 60 days without any commit (spec 010 §14).

1. GitHub → **Actions** → for each workflow whose name starts with `daily-`, `weekly-` or `monthly-`, open it and
   click **Enable workflow** (the banner at the top).
2. Run `daily-prices` and `daily-tld-registry` once by hand (**Run workflow**) so the data is fresh at once.
3. Any commit to `main` (for example a Dependabot update) resets the 60-day timer.

**Check:** `/status` shows every daily dataset as "Up to date" the next morning.
