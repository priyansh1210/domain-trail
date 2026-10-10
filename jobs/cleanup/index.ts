// Daily clean-up (spec 010 tech §5.6, spec 012 §5.2–5.3, spec 015 §5.1–5.5; FR-REF-010, FR-DATA-003, 009,
// FR-OBS-002, 003, 004, 007). Deletes data past its retention period, rolls feedback into monthly aggregates before
// the raw rows go, writes yesterday's search metrics, measures the database and the budgets, and warns about stale
// data. Running it also keeps the free database from pausing after 7 idle days.
import { accounts, budgets, jev, jobs as jobCfg, retention as r } from '@domains-all/config/defaults';
import { meterAlerts, type Meter } from '@domains-all/metrics';
import type { Db } from '../_lib/db';
import type { JobContext, JobDefinition, JobStats } from '../_lib/run';

const MB = 1024 * 1024;
const DAY_MS = 86_400_000;
const isoDay = (d: Date) => d.toISOString().slice(0, 10);

/** Retention rules (spec 012 §5.2). Each runs on its own so one failure does not stop the others. */
export function retentionStatements(mitigate: boolean): Array<[string, string]> {
  const graceDays = mitigate ? budgets.mitigation.domainCheckGraceDays : r.domainCheckGraceDays;
  const anonDays = mitigate ? budgets.mitigation.anonymousSearchDays : r.anonymousSearchDays;
  const feedbackCut = `date_trunc('month', now()) - interval '${r.feedbackMonths} months'`;
  return [
    [
      'searches',
      `delete from public.searches s
       where (s.expires_at < now() or (s.user_id is null and s.created_at < now() - interval '${anonDays} days'))
         and not exists (select 1 from public.saved_searches ss where ss.search_id = s.id)`,
    ],
    ['result_cache', `delete from public.result_cache where expires_at < now()`],
    [
      'domain_checks',
      `delete from public.domain_checks where expires_at < now() - interval '${graceDays} days'`,
    ],
    [
      'word_cache',
      `delete from public.word_cache where fetched_at < now() - interval '${r.wordCacheDays} days'`,
    ],
    ['keyword_trends', `delete from public.keyword_trends where day < current_date - ${r.keywordTrendDays}`],
    ['fx_rates', `delete from public.fx_rates where as_of < current_date - ${r.fxRateDays}`],
    [
      'notifications',
      `delete from public.notifications where created_at < now() - interval '${r.notificationDays} days'`,
    ],
    [
      'anonymous_savers',
      `delete from auth.users where id in (select user_id from public.anon_visitors
         where last_seen_at < now() - interval '${accounts.anonSavedRetentionDays} days')`,
    ],
    [
      'contact_messages',
      `delete from public.contact_messages where created_at < now() - interval '${r.contactMessageDays} days'`,
    ],
    ['email_log', `delete from public.email_log where day < current_date - ${r.emailLogDays}`],
    ['job_runs', `delete from public.job_runs where started_at < now() - interval '${r.jobRunDays} days'`],
    ['alert_log', `delete from public.alert_log where sent_at < now() - interval '30 days'`],
    ['feedback', `delete from public.feedback where created_at < ${feedbackCut}`],
    ['result_events', `delete from public.result_events where created_at < ${feedbackCut}`],
  ];
}

/** Adds one day of votes, buy clicks and copies to `feedback_monthly` while the result rows still exist. */
async function rollUpDay(db: Db, day: string): Promise<void> {
  await db.query(
    `insert into public.feedback_monthly as m (month, section, strategy, votes_up, votes_down, buy_clicks, copies)
     select date_trunc('month', $1::date)::date, coalesce(sr.section, 'unknown'), coalesce(sr.strategy, 'unknown'),
            count(*) filter (where x.kind = 'up'), count(*) filter (where x.kind = 'down'),
            count(*) filter (where x.kind = 'buy'), count(*) filter (where x.kind = 'copy')
     from (
       select f.search_id, f.fqdn, case when f.vote = 1 then 'up' else 'down' end as kind
       from public.feedback f where f.created_at >= $1::date and f.created_at < $1::date + 1
       union all
       select e.search_id, e.fqdn, e.action from public.result_events e
       where e.action in ('buy', 'copy') and e.created_at >= $1::date and e.created_at < $1::date + 1
     ) x
     left join public.search_results sr on sr.search_id = x.search_id and sr.fqdn = x.fqdn
     group by 1, 2, 3
     on conflict (month, section, strategy) do update set
       votes_up = m.votes_up + excluded.votes_up, votes_down = m.votes_down + excluded.votes_down,
       buy_clicks = m.buy_clicks + excluded.buy_clicks, copies = m.copies + excluded.copies`,
    [day],
  );
}

/** Rolls up every finished day since the last run (at most 7 back), each day exactly once (FR-REF-011). */
async function rollUpFeedback(ctx: JobContext): Promise<number> {
  const yesterday = isoDay(new Date(ctx.now.getTime() - DAY_MS));
  const [row] = await ctx.db.query<{ state: { lastRolledDay?: string } }>(
    `select state from public.job_state where job = 'cleanup:feedback'`,
  );
  const oldest = isoDay(new Date(ctx.now.getTime() - 7 * DAY_MS));
  let day = row?.state.lastRolledDay
    ? isoDay(new Date(Date.parse(row.state.lastRolledDay) + DAY_MS))
    : yesterday;
  if (day < oldest) day = oldest;
  let n = 0;
  for (; day <= yesterday; day = isoDay(new Date(Date.parse(day) + DAY_MS)), n++) {
    const d = day;
    await ctx.db.tx(async (t) => {
      await rollUpDay(t, d);
      await t.query(
        `insert into public.job_state (job, state, updated_at) values ('cleanup:feedback', $1::text::jsonb, now())
         on conflict (job) do update set state = excluded.state, updated_at = now()`,
        [JSON.stringify({ lastRolledDay: d })],
      );
    });
  }
  return n;
}

const percentile = (sorted: readonly number[], p: number) =>
  sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]! : null;

/** Daily product metrics (spec 015 §5.5) for one finished day; recomputed in full, so re-runs are safe. */
export async function dailyMetrics(db: Db, day: string): Promise<number> {
  const rows = await db.query<{
    status: string;
    degraded: boolean;
    jev_tokens: number;
    duration_ms: number | null;
    stage_ms: Record<string, number> | null;
  }>(
    `select status, degraded, jev_tokens, duration_ms, stage_ms from public.searches
     where created_at >= $1::date and created_at < $1::date + 1`,
    [day],
  );
  const [extra] = await db.query<{ actions: number; up: number; down: number }>(
    `select (select count(*)::int from public.result_events where created_at >= $1::date and created_at < $1::date + 1) as actions,
            (select count(*)::int from public.feedback where vote = 1 and created_at >= $1::date and created_at < $1::date + 1) as up,
            (select count(*)::int from public.feedback where vote = -1 and created_at >= $1::date and created_at < $1::date + 1) as down`,
    [day],
  );
  const durations = rows
    .map((x) => x.duration_ms)
    .filter((v): v is number => typeof v === 'number')
    .sort((a, b) => a - b);
  const stages = new Map<string, number[]>();
  for (const x of rows)
    for (const [k, v] of Object.entries(x.stage_ms ?? {}))
      if (typeof v === 'number') stages.set(k, [...(stages.get(k) ?? []), v]);
  const stageP = (p: number) =>
    Object.fromEntries(
      [...stages].map(([k, v]) => [
        k,
        percentile(
          [...v].sort((a, b) => a - b),
          p,
        ),
      ]),
    );
  const count = (f: (x: (typeof rows)[number]) => boolean) => rows.filter(f).length;
  await db.query(
    `insert into public.search_metrics_daily (day, searches, cache_hits, p50_ms, p95_ms, p50_stage_ms, p95_stage_ms,
       avg_tokens, degraded, refused, needs_detail, actions, thumbs_up, thumbs_down)
     values ($1::date, $2, null, $3, $4, $5::text::jsonb, $6::text::jsonb, $7, $8, $9, $10, $11, $12, $13)
     on conflict (day) do update set searches = excluded.searches, p50_ms = excluded.p50_ms, p95_ms = excluded.p95_ms,
       p50_stage_ms = excluded.p50_stage_ms, p95_stage_ms = excluded.p95_stage_ms, avg_tokens = excluded.avg_tokens,
       degraded = excluded.degraded, refused = excluded.refused, needs_detail = excluded.needs_detail,
       actions = excluded.actions, thumbs_up = excluded.thumbs_up, thumbs_down = excluded.thumbs_down`,
    [
      day,
      rows.length,
      percentile(durations, 0.5),
      percentile(durations, 0.95),
      JSON.stringify(stageP(0.5)),
      JSON.stringify(stageP(0.95)),
      rows.length ? Math.round(rows.reduce((a, x) => a + Number(x.jev_tokens), 0) / rows.length) : null,
      count((x) => x.degraded),
      count((x) => x.status === 'refused'),
      count((x) => x.status === 'needs_detail'),
      extra?.actions ?? 0,
      extra?.up ?? 0,
      extra?.down ?? 0,
    ],
  );
  return rows.length;
}

/** Meter readings for spec 015 §5.1 (database size, Jev tokens, e-mails). */
export async function readMeters(db: Db, now: Date, dbMb: number): Promise<Meter[]> {
  const month = isoDay(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)));
  const yesterday = isoDay(new Date(now.getTime() - DAY_MS));
  const [u] = await db.query<{ tokens: string; eval: string }>(
    `select coalesce(sum(input_tokens), 0)::text as tokens, coalesce(sum(eval_tokens), 0)::text as eval
     from public.jev_usage where day >= $1::date`,
    [month],
  );
  const [e] = await db.query<{ month: number; day: number }>(
    `select coalesce(sum(sent) filter (where day >= $1::date), 0)::int as month,
            coalesce(sum(sent) filter (where day = $2::date), 0)::int as day
     from public.email_log where day >= least($1::date, $2::date)`,
    [month, yesterday],
  );
  return [
    { resource: 'db', used: dbMb, limit: r.dbSizeLimitMb, period: 'now', unit: 'MB' },
    { resource: 'jev-tokens', used: Number(u?.tokens ?? 0), limit: jev.monthlyTokenCap, period: 'month' },
    { resource: 'eval-tokens', used: Number(u?.eval ?? 0), limit: jev.evalMonthlyTokenCap, period: 'month' },
    { resource: 'email-day', used: e?.day ?? 0, limit: budgets.emailsPerDay, period: 'day' },
    { resource: 'email-month', used: e?.month ?? 0, limit: budgets.emailsPerMonth, period: 'month' },
  ];
}

const WEEKLY = new Set(['brand-list', 'backup']);
const DATASET_JOBS = ['tld-registry', 'refresh-prices', 'nrd-ingest', 'refresh-free-providers', 'brand-list'];

/** Datasets whose job last succeeded too long ago (spec 015 alert `data-stale`). */
export async function staleDatasets(db: Db, now: Date): Promise<string[]> {
  const rows = await db.query<{ job: string; last_success_at: string | Date | null }>(
    `select job, last_success_at from public.public_job_status()`,
  );
  return rows
    .filter((x) => DATASET_JOBS.includes(x.job))
    .filter((x) => {
      const limitH = WEEKLY.has(x.job) ? jobCfg.staleAfterHours.weekly : jobCfg.staleAfterHours.daily;
      const at = x.last_success_at ? new Date(x.last_success_at).getTime() : 0;
      return now.getTime() - at > limitH * 3600_000;
    })
    .map((x) => x.job);
}

export const cleanup: JobDefinition = {
  name: 'cleanup',
  async run(ctx) {
    const [size] = await ctx.db.query<{ bytes: string }>(
      `select pg_database_size(current_database())::text as bytes`,
    );
    const dbMb = Math.round((Number(size?.bytes ?? 0) / MB) * 10) / 10;
    const mitigate = dbMb > r.dbSizeLimitMb * r.dbSizeWarnRatio;

    // Roll up first: the retention step may delete the results the roll-up joins to.
    const rolledDays = await rollUpFeedback(ctx);
    const yesterday = isoDay(new Date(ctx.now.getTime() - DAY_MS));
    const metricsSearches = await dailyMetrics(ctx.db, yesterday);

    const stats: JobStats = { dbMb, mitigation: mitigate, rolledDays, searchesYesterday: metricsSearches };
    const errors: string[] = [];
    let deleted = 0;
    for (const [name, sql] of retentionStatements(mitigate)) {
      try {
        const n = (
          await ctx.db.query(`with d as (${sql} returning 1) select count(*)::int as n from d`)
        )[0] as { n: number } | undefined;
        if (n?.n) stats[`deleted_${name}`] = n.n;
        deleted += n?.n ?? 0;
      } catch (e) {
        errors.push(`${name}: ${(e as Error).message.slice(0, 120)}`);
      }
    }
    stats.deleted = deleted;

    const alerts = meterAlerts(await readMeters(ctx.db, ctx.now, dbMb), ctx.now);
    if (mitigate)
      alerts.push({
        level: 'warning',
        key: 'db-size-mitigation',
        message: `Database at ${dbMb} MB: shorter retention is on (spec 012 §5.3)`,
        data: { dbMb },
      });
    const stale = await staleDatasets(ctx.db, ctx.now);
    if (stale.length)
      alerts.push({
        level: 'warning',
        key: 'data-stale',
        message: `Data not refreshed in time: ${stale.join(', ')}`,
        data: { jobs: stale.join(',') },
      });
    for (const a of alerts) await ctx.alert(a.level, a.key, a.message, a.data);
    stats.alerts = alerts.length;
    if (stale.length) stats.stale = stale.join(',');

    if (errors.length) throw new Error(`retention failed for ${errors.join('; ')}`);
    return stats;
  },
};
