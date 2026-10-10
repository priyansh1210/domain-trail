# Security or data incident

**When:** someone may have seen or changed data they should not (a leaked key, a bug exposing saved items, a
suspicious login), or the site is being abused. Spec 013 FR-PRIV-015, tech §5.6.

1. **Detect** — note what you saw, when, and from where (alert e-mail, error report, a user's message).
2. **Contain** (first hour) — rotate any exposed secret (`rotate-secrets.md`); roll back a bad release
   (`rollback.md`); if a feature leaks data, switch it off (for example remove `SUPABASE_SERVICE_ROLE_KEY` in Vercel to
   stop all saving, or set `MOCK_EXTERNALS=1` for a fully safe mode) and redeploy.
3. **Assess** — which data, how many people, which period. The database has `job_runs`, Vercel and Supabase keep
   their own logs. Write it down in a private note.
4. **Notify** —
   - affected users without undue delay (in-app note or e-mail to their address), saying what happened and what to do;
   - the Data Protection Board of India as the DPDP rules require;
   - for users in the EU/UK, the data-protection authority within 72 hours when the GDPR applies.
5. **Recover** — fix, deploy, check (`deploy.md`), and confirm the leak has stopped.
6. **Review** within 7 days — what happened, why, what changes prevent it; update the specs and runbooks.

Contact for reports from others: the grievance contact on `/contact`.
