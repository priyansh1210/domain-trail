// Spec 015 tech §11 / spec 012: daily metrics, feedback roll-up (each day once), meters and stale-data alerts
// (FR-OBS-002, 003, 004, 007, FR-DATA-009).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Db, memoryDb } from '../_lib/db';
import { cleanup, dailyMetrics, readMeters, staleDatasets } from '../cleanup';
import { one, run, testEnv } from './support';

let db: Db;
const S = '0190f5a8-0000-7000-8000-000000000001';
const now = new Date();
const yesterday = new Date(now.getTime() - 86_400_000).toISOString().slice(0, 10);

beforeAll(async () => {
  db = await memoryDb();
  await db.query(
    `insert into public.searches (id, cache_key, status, prefs, pipeline_version, created_at, expires_at,
       degraded, jev_tokens, duration_ms, stage_ms)
     values ($1, 'k', 'done', '{}', '0.1.0', $2::date + interval '10 hours', now() + interval '6 days',
       true, 1200, 9000, '{"S1": 1500, "verify": 6000}')`,
    [S, yesterday],
  );
  await db.query(
    `insert into public.search_results (search_id, fqdn, section, rank, score, status, signals, reasons, strategy)
     values ($1, 'a.com', 'budget', 0, 1, 'available', '{}', '[]', 'compound')`,
    [S],
  );
  await db.query(
    `insert into public.feedback (search_id, fqdn, visitor_hash, vote, created_at)
     values ($1, 'a.com', 'h1', 1, $2::date + interval '11 hours'), ($1, 'a.com', 'h2', -1, $2::date + interval '12 hours')`,
    [S, yesterday],
  );
});
afterAll(async () => {
  await db?.close();
});

describe('daily metrics', () => {
  it('summarises yesterday’s searches from whitelisted numbers only', async () => {
    expect(await dailyMetrics(db, yesterday)).toBe(1);
    const m = await one<Record<string, unknown>>(
      db,
      `select searches, p50_ms, degraded, avg_tokens, thumbs_up, thumbs_down, p50_stage_ms from public.search_metrics_daily where day = $1::date`,
      [yesterday],
    );
    expect(m).toMatchObject({
      searches: 1,
      p50_ms: 9000,
      degraded: 1,
      avg_tokens: 1200,
      thumbs_up: 1,
      thumbs_down: 1,
    });
    expect(m.p50_stage_ms).toEqual({ S1: 1500, verify: 6000 });
  });
});

describe('cleanup job', () => {
  it('rolls each finished day into the monthly feedback totals exactly once', async () => {
    await run(cleanup, db, { now });
    await run(cleanup, db, { now });
    const rows = await db.query(
      `select section, strategy, votes_up, votes_down from public.feedback_monthly`,
    );
    expect(rows).toEqual([{ section: 'budget', strategy: 'compound', votes_up: 1, votes_down: 1 }]);
  });

  it('reads the budget meters', async () => {
    await db.query(`insert into public.jev_usage (day, input_tokens) values (current_date, 90000000)`);
    const meters = await readMeters(db, now, 12);
    expect(meters.find((m) => m.resource === 'jev-tokens')).toMatchObject({
      used: 90_000_000,
      limit: 100_000_000,
    });
    expect(meters.find((m) => m.resource === 'db')).toMatchObject({ used: 12, limit: 500 });
  });

  it('alerts the owner about budgets and stale data', async () => {
    await db.query(
      `insert into public.job_runs (job, run_date, status, started_at, finished_at)
       values ('refresh-prices', current_date - 3, 'success', now() - interval '3 days', now() - interval '3 days')`,
    );
    expect(await staleDatasets(db, now)).toEqual(['refresh-prices']);
    const sent: string[] = [];
    const alertFetch = (async (_u: unknown, init?: RequestInit) => {
      sent.push(String((JSON.parse(String(init?.body)) as { subject: string }).subject));
      return new Response('{}');
    }) as typeof fetch;
    const outcome = await run(cleanup, db, {
      now,
      env: testEnv({ RESEND_API_KEY: 're_x', OWNER_ALERT_EMAIL: 'owner@example.com' }),
      alertFetch,
    });
    expect(outcome.stats).toMatchObject({ stale: 'refresh-prices' });
    expect(sent.some((s) => s.includes('budget-jev-tokens-80'))).toBe(true);
    expect(sent.some((s) => s.includes('data-stale'))).toBe(true);
  });
});
