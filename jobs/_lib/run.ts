// runJob (spec 010 tech §1, §5.7; FR-REF-011, 012, 014): one row per run in `job_runs` with start, end, result and
// statistics; never two runs of the same job at once; a second failure in a row alerts the owner.
//
// The lock is a lease row taken under a transaction-scoped advisory lock, not a session lock: Supabase's
// transaction pooler may hand each statement a different server connection, so session locks are unreliable there.
import { jobs as cfg } from '@domains-all/config/defaults';
import type { ServerEnv } from '@domains-all/config';
import { siteIdentity } from '@domains-all/config';
import { scrubText, type Logger } from '@domains-all/log';
import { type DedupeStore, sendAlert, type AlertLevel } from '@domains-all/metrics';
import type { Db } from './db';

export type JobName =
  | 'tld-registry'
  | 'refresh-prices'
  | 'nrd-ingest'
  | 'refresh-free-providers'
  | 'brand-list'
  | 'cleanup'
  | 'backup'
  | 'usage-report'
  | 'tune-weights';

export type JobStats = Record<string, number | string | boolean>;

export interface JobContext {
  name: JobName;
  db: Db;
  log: Logger;
  now: Date;
  /** UTC date of the run, YYYY-MM-DD. */
  runDate: string;
  /** Re-do work that is already done for the day (manual runs). */
  force: boolean;
  /** Fixtures and an in-process database; nothing leaves the machine. */
  dryRun: boolean;
  env: ServerEnv;
  fetch: typeof fetch;
  sleep(ms: number): Promise<void>;
  /** Sends an owner alert (de-duplicated per key for 6 h); returns what happened. */
  alert(level: AlertLevel, key: string, message: string, data?: JobStats): Promise<string>;
  /** Sends a report to the owner (info level, delivered when a channel is configured). */
  report(key: string, message: string, data?: JobStats): Promise<string>;
}

export interface JobDefinition {
  name: JobName;
  run(ctx: JobContext): Promise<JobStats>;
}

export interface RunOptions {
  db: Db;
  env: ServerEnv;
  log: Logger;
  now?: Date;
  force?: boolean;
  dryRun?: boolean;
  fetch?: typeof fetch;
  /** Fetch used for alerts (separate so tests can record alerts without affecting downloads). */
  alertFetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

export interface RunOutcome {
  status: 'success' | 'failed' | 'skipped';
  stats?: JobStats;
  error?: string;
  alert?: string;
}

/** Alert de-duplication in `alert_log` (spec 015 §5.2: once per key per 6 hours). */
export class DbDedupe implements DedupeStore {
  constructor(private readonly db: Db) {}
  async claim(key: string, level: AlertLevel, ttlSeconds: number) {
    const rows = await this.db.query(
      `insert into public.alert_log as a (key, level, sent_at) values ($1, $2, now())
       on conflict (key) do update set level = excluded.level, sent_at = excluded.sent_at
       where a.sent_at < now() - make_interval(secs => $3::double precision)
       returning a.key`,
      [key, level, ttlSeconds],
    );
    return rows.length > 0;
  }
}

/** Short, scrubbed error text for `job_runs.error` and alerts (workflow logs are public — spec 010 §9). */
export function errorSummary(e: unknown): string {
  const text = e instanceof Error ? e.message : String(e);
  return scrubText(text)
    .replace(/postgres(?:ql)?:\/\/\S+/gi, '[db-url]')
    .slice(0, 500);
}

export async function runJob(job: JobDefinition, opts: RunOptions): Promise<RunOutcome> {
  const { db, env, log } = opts;
  const now = opts.now ?? new Date();
  const runDate = now.toISOString().slice(0, 10);

  const id = await db.tx(async (t) => {
    await t.query('select pg_advisory_xact_lock(hashtext($1))', [`job:${job.name}`]);
    await t.query(
      `update public.job_runs set status = 'failed', finished_at = now(), error = 'abandoned: no finish recorded'
       where job = $1 and status = 'running' and started_at < now() - make_interval(mins => $2::int)`,
      [job.name, cfg.leaseMinutes],
    );
    const running = await t.query(
      `select 1 from public.job_runs where job = $1 and status = 'running' limit 1`,
      [job.name],
    );
    if (running.length > 0) {
      await t.query(
        `insert into public.job_runs (job, run_date, status, finished_at, error)
         values ($1, $2::date, 'skipped', now(), 'another run of this job is still going')`,
        [job.name, runDate],
      );
      return null;
    }
    const [row] = await t.query<{ id: string }>(
      `insert into public.job_runs (job, run_date, status) values ($1, $2::date, 'running') returning id::text as id`,
      [job.name, runDate],
    );
    return row!.id;
  });
  if (id === null) {
    log.warn({ event: 'job.skipped', job: job.name });
    return { status: 'skipped' };
  }

  const dedupe = new DbDedupe(db);
  const alertCfg = {
    channel: env.ALERT_CHANNEL,
    siteName: siteIdentity(env).name,
    resendApiKey: env.RESEND_API_KEY,
    ownerEmail: env.OWNER_ALERT_EMAIL,
    from: env.EMAIL_FROM,
    webhookUrl: env.ALERT_WEBHOOK_URL,
  };
  const deliver = async (
    level: AlertLevel,
    key: string,
    message: string,
    data?: JobStats,
    notify = false,
  ) => {
    const outcome = opts.dryRun
      ? 'dry_run'
      : await sendAlert({ level, key, message, data, notify }, alertCfg, {
          dedupe,
          fetchFn: opts.alertFetch,
        });
    log.info({ event: 'job.alert', job: job.name, key, level, outcome });
    return outcome;
  };
  const alert: JobContext['alert'] = (level, key, message, data) => deliver(level, key, message, data);

  const ctx: JobContext = {
    name: job.name,
    db,
    log,
    now,
    runDate,
    force: opts.force ?? false,
    dryRun: opts.dryRun ?? false,
    env,
    fetch: opts.fetch ?? ((input, init) => fetch(input, init)),
    sleep: opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms))),
    alert,
    report: (key, message, data) => deliver('info', key, message, data, true),
  };

  const started = Date.now();
  try {
    const stats = { ...(await job.run(ctx)), seconds: Math.round((Date.now() - started) / 1000) };
    await db.query(
      `update public.job_runs set status = 'success', finished_at = now(), stats = $2::text::jsonb where id = $1::bigint`,
      [id, JSON.stringify(stats)],
    );
    log.info({ event: 'job.success', job: job.name, ...stats });
    return { status: 'success', stats };
  } catch (e) {
    const error = errorSummary(e);
    await db.query(
      `update public.job_runs set status = 'failed', finished_at = now(), error = $2,
         stats = $3::text::jsonb where id = $1::bigint`,
      [id, error, JSON.stringify({ seconds: Math.round((Date.now() - started) / 1000) })],
    );
    log.error({ event: 'job.failed', job: job.name, error });
    // FR-REF-014: the previous finished run failed too → tell the owner (GitHub e-mails every failure anyway).
    const [previous] = await db.query<{ status: string }>(
      `select status from public.job_runs
       where job = $1 and id <> $2::bigint and status in ('success', 'failed')
       order by started_at desc, id desc limit 1`,
      [job.name, id],
    );
    const sent =
      previous?.status === 'failed'
        ? await alert('warning', `job-failed-twice:${job.name}`, `${job.name} failed twice in a row`, {
            error,
          })
        : undefined;
    return { status: 'failed', error, ...(sent ? { alert: sent } : {}) };
  }
}
