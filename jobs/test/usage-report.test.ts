// Spec 015 tech §11 `usage-report.test.ts`: the report compiles from stored data (FR-OBS-008, 011).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Db, memoryDb } from '../_lib/db';
import { compileReport, MANUAL_CHECKS, reportText, usageReport } from '../usage-report';
import { one, run } from './support';

let db: Db;
const now = new Date('2026-11-01T07:00:00Z');

beforeAll(async () => {
  db = await memoryDb();
  await db.query(
    `insert into public.jev_usage (day, input_tokens, eval_tokens) values ('2026-10-05', 5000000, 100000)`,
  );
  await db.query(`insert into public.email_log (day, provider, sent) values ('2026-10-06', 'resend', 3)`);
  await db.query(
    `insert into public.job_runs (job, run_date, status, started_at) values
       ('refresh-prices', '2026-10-01', 'success', '2026-10-01T01:00:00Z'),
       ('refresh-prices', '2026-10-02', 'failed', '2026-10-02T01:00:00Z'),
       ('refresh-prices', '2026-10-03', 'success', '2026-10-03T01:00:00Z'),
       ('refresh-prices', '2026-11-01', 'success', '2026-11-01T01:00:00Z')`,
  );
  await db.query(
    `insert into public.search_metrics_daily (day, searches, degraded, refused, needs_detail, actions, thumbs_up, thumbs_down, p95_ms)
     values ('2026-10-05', 40, 40, 1, 2, 10, 3, 1, 14000), ('2026-10-06', 60, 60, 0, 1, 5, 2, 0, 12000)`,
  );
});
afterAll(async () => {
  await db?.close();
});

describe('usage report', () => {
  it('covers the previous month only', async () => {
    const r = await compileReport(db, now);
    expect(r.period).toBe('2026-10');
    expect(r.meters['jev-tokens']).toEqual({ used: 5_000_000, limit: 100_000_000, percent: 5 });
    expect(r.meters.emails!.used).toBe(3);
    expect(r.jobs['refresh-prices']).toEqual({ success: 2, failed: 1, successRate: 66.7 });
    expect(r.product).toMatchObject({ searches: 100, degraded: 100, worst_day_p95_ms: 14000 });
    expect(r.manual).toEqual(MANUAL_CHECKS);
  });

  it('writes counts only into the owner message', async () => {
    const text = reportText(await compileReport(db, now));
    expect(text).toContain('refresh-prices: 2 ok, 1 failed (66.7%)');
    expect(text).not.toMatch(/@/);
  });

  it('stores one report per month, also when run again', async () => {
    await run(usageReport, db, { now });
    await run(usageReport, db, { now });
    const n = await one<{ n: number }>(
      db,
      `select count(*)::int as n from public.quality_reports where kind = 'monthly' and period = '2026-10'`,
    );
    expect(n.n).toBe(1);
  });
});
