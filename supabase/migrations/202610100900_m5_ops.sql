-- M5 freshness & ops (tasks/M5-freshness.md; spec 010 tech §3, spec 015 tech §5.2).

-- Small per-job state that must change in the same transaction as the job's data, e.g. the last day whose
-- feedback was rolled up (so a re-run never counts a day twice — FR-REF-011).
create table public.job_state (
  job text primary key,
  state jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- Owner alerts sent from scheduled jobs: one per key per 6 hours (FR-OBS-010).
create table public.alert_log (
  key text primary key,
  level text not null check (level in ('info', 'warning', 'critical')),
  sent_at timestamptz not null
);

-- Server-only, like every operations table (spec 012 §4): RLS on, no policies.
alter table public.job_state enable row level security;
alter table public.alert_log enable row level security;

-- Status page (FR-REF-015, FR-UX-011): job names, run times and how many runs failed in a row — nothing else from
-- job_runs (no statistics, no error text), so the public key may call it.
create function public.public_job_status()
returns table (
  job text,
  last_success_at timestamptz,
  last_status text,
  last_run_at timestamptz,
  failures_in_row int
)
language sql
stable
security definer
set search_path = ''
as $$
  with ranked as (
    select r.job, r.status, coalesce(r.finished_at, r.started_at) as at,
           row_number() over (partition by r.job order by r.started_at desc) as n
    from public.job_runs r
    where r.status <> 'skipped'
  ),
  first_success as (
    select job, min(n) as n from ranked where status = 'success' group by job
  )
  select j.job,
         (select max(r.at) from ranked r where r.job = j.job and r.status = 'success'),
         (select r.status from ranked r where r.job = j.job and r.n = 1),
         (select r.at from ranked r where r.job = j.job and r.n = 1),
         (select count(*)::int from ranked r
           where r.job = j.job and r.status = 'failed'
             and r.n < coalesce((select f.n from first_success f where f.job = j.job), 2147483647))
  from (select distinct job from ranked) j
  order by j.job;
$$;

revoke execute on function public.public_job_status() from public;
grant execute on function public.public_job_status() to anon, authenticated, service_role;

-- Popular-site names for the brand check (spec 014 §5.2), best rank first, in one call for the server (service
-- role only: brand_labels is server-only reference data, spec 012 §4).
create function public.brand_label_list()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(string_agg(label, ',' order by best_rank, label), '') from public.brand_labels;
$$;

revoke execute on function public.brand_label_list() from public, anon, authenticated;
grant execute on function public.brand_label_list() to service_role;
