# Roll back a bad deploy

**When:** the live site breaks after a deploy (errors, `/api/health` not ok, searches failing). Spec 017 FR-INF-007.

1. Vercel → the project → **Deployments** → the previous deployment marked *Production* → menu → **Instant Rollback**.
   The old version is live again within seconds.
2. Leave the database alone: migrations are backward compatible, so the previous version works with the new schema.
3. Fix the problem in a new pull request and deploy normally (`deploy.md`); the next deploy of `main` replaces the
   rollback.

**Check:** `/api/health` shows the older `version` and `"ok":true`.

Practise this once a quarter on a harmless change (rollback drill, spec 017 §11).
