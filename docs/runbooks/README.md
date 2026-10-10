# Runbooks

Short, step-by-step instructions for routine and emergency chores (spec 017 tech §5.5, FR-INF-008). Each one says
when to use it, what to do and how to check it worked.

| Runbook | Use it when |
|---|---|
| [rerun-job.md](./rerun-job.md) | a daily, weekly or monthly job failed, or data on the Status page is old |
| [reenable-workflows.md](./reenable-workflows.md) | GitHub stopped running the scheduled jobs |
| [restore-db.md](./restore-db.md) | data was lost or damaged, and for the quarterly restore drill |
| [supabase-unpause.md](./supabase-unpause.md) | the free database was paused |
| [budget-exhausted.md](./budget-exhausted.md) | a budget alert arrived or a free limit was reached |
| [deploy.md](./deploy.md) | a pull request is ready to go live |
| [rollback.md](./rollback.md) | the live site broke after a deploy |
| [rotate-secrets.md](./rotate-secrets.md) | a secret may have leaked, or once a year |
| [incident.md](./incident.md) | someone may have seen or changed data they should not |
