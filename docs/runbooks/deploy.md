# Deploy

**When:** a pull request is ready. Production deploys happen only from `main` (spec 017 FR-INF-002, 003).

1. Open the pull request on GitHub. Wait for the checks `checks`, `db`, `gitleaks`, `audit` and `codeql` to pass, and
   look at the Vercel preview link in the pull request.
2. Merge with **Squash and merge**. Vercel deploys `main` to https://domain-trail.vercel.app within a few minutes.
3. If the pull request changed `supabase/migrations/`, GitHub starts the **migrate** workflow: open Actions → migrate
   → *Review deployments* → approve `production`.
4. **Check:** `/api/health` shows `"ok":true` and the new `version` (first 12 characters of the merge commit);
   `/status` shows the datasets as usual. If something is wrong, see `rollback.md`.

Migrations are always backward compatible (add first, remove in a later release), so the site keeps working while a
migration waits for approval.
