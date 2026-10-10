# Restore a backup (and the quarterly drill)

**When:** data was lost or damaged, or once a quarter to prove the backups work (NFR-DATA-002). Do the drill on your
own computer first; never restore into the live database without trying locally.

You need: the offline file `backup-key.txt` (from `docs/setup.md` Part C step 4), `age`, Docker Desktop, Node and
pnpm.

1. GitHub → Actions → **weekly-backup** → the run you want → *Artifacts* → download `backup-…` and unzip it. You get
   `backup-YYYY-MM-DD.tar.gz.age` (backups are kept 28 days).
2. Decrypt and unpack:
   ```bash
   age -d -i backup-key.txt -o backup.tar.gz backup-YYYY-MM-DD.tar.gz.age
   mkdir restore && tar -xzf backup.tar.gz -C restore      # schema.sql, data.sql, auth-users.csv
   ```
3. Start an empty local database with today's schema:
   ```bash
   pnpm exec supabase start
   pnpm exec supabase db reset
   ```
4. Load the users first (saved items point at them), then the data:
   ```bash
   psql postgresql://postgres:postgres@127.0.0.1:54322/postgres \
     -c "\copy auth.users (id, email, is_anonymous, created_at) from 'restore/auth-users.csv' csv header"
   psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -f restore/data.sql
   ```
5. **Check:** row counts look right, e.g.
   `select count(*) from tld_prices; select count(*) from saved_searches; select max(started_at) from job_runs;`
   and `pnpm dev` with `apps/web/.env.local` pointing at the local database shows prices.
6. Real recovery only: create a new Supabase project (Mumbai), run the **migrate** workflow against it, repeat
   step 4 with its connection string, then switch the Vercel and GitHub secrets to the new project. Delete the
   decrypted files afterwards — they contain e-mail addresses.

Write the date and result of each drill in `tasks/` (or the monthly report notes).
