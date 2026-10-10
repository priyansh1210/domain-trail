// Spec 010 tech §11 `run-job.test.ts`: lock, job_runs lifecycle, double-failure alert (FR-REF-011, 012, 014).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Db, memoryDb } from '../_lib/db';
import { errorSummary, type JobDefinition } from '../_lib/run';
import { one, run, testEnv } from './support';

let db: Db;
beforeAll(async () => {
  db = await memoryDb();
});
afterAll(async () => {
  await db?.close();
});

const ok: JobDefinition = { name: 'cleanup', run: async () => ({ rows: 3 }) };
const boom: JobDefinition = {
  name: 'tld-registry',
  run: async () => {
    throw new Error('IANA answered 503 for postgresql://user:pw@host/db');
  },
};

function alertRecorder() {
  const sent: Array<Record<string, unknown>> = [];
  const fetchFn = (async (_input: unknown, init?: RequestInit) => {
    sent.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    return new Response('{}', { status: 200 });
  }) as typeof fetch;
  return { sent, fetchFn };
}

describe('runJob', () => {
  it('records start, end, result and statistics', async () => {
    const outcome = await run(ok, db);
    expect(outcome).toMatchObject({ status: 'success', stats: { rows: 3 } });
    const row = await one<{ status: string; stats: { rows: number }; finished_at: unknown }>(
      db,
      `select status, stats, finished_at from public.job_runs where job = 'cleanup' order by id desc limit 1`,
    );
    expect(row.status).toBe('success');
    expect(row.stats.rows).toBe(3);
    expect(row.finished_at).not.toBeNull();
  });

  it('skips while another run of the same job is going (FR-REF-012)', async () => {
    await db.query(
      `insert into public.job_runs (job, run_date, status) values ('cleanup', current_date, 'running')`,
    );
    expect((await run(ok, db)).status).toBe('skipped');
    await db.query(`delete from public.job_runs where job = 'cleanup' and status in ('running', 'skipped')`);
  });

  it('treats a run without a finish after the lease as abandoned', async () => {
    await db.query(
      `insert into public.job_runs (job, run_date, status, started_at)
       values ('cleanup', current_date, 'running', now() - interval '2 hours')`,
    );
    expect((await run(ok, db)).status).toBe('success');
    const abandoned = await one<{ n: number }>(
      db,
      `select count(*)::int as n from public.job_runs where job = 'cleanup' and error like 'abandoned%'`,
    );
    expect(abandoned.n).toBe(1);
  });

  it('alerts the owner only on the second failure in a row (FR-REF-014)', async () => {
    const { sent, fetchFn } = alertRecorder();
    const env = testEnv({ RESEND_API_KEY: 're_test', OWNER_ALERT_EMAIL: 'owner@example.com' });
    const first = await run(boom, db, { env, alertFetch: fetchFn });
    expect(first.status).toBe('failed');
    expect(sent).toHaveLength(0);
    const second = await run(boom, db, { env, alertFetch: fetchFn });
    expect(second.alert).toBe('sent');
    expect(sent).toHaveLength(1);
    expect(sent[0]!.subject).toContain('job-failed-twice:tld-registry');
    // The same alert is not repeated within 6 hours.
    expect((await run(boom, db, { env, alertFetch: fetchFn })).alert).toBe('deduped');
  });

  it('keeps database addresses and e-mail addresses out of stored errors', async () => {
    const row = await one<{ error: string }>(
      db,
      `select error from public.job_runs where job = 'tld-registry' order by id desc limit 1`,
    );
    expect(row.error).toContain('[db-url]');
    expect(row.error).not.toContain('pw@host');
    expect(errorSummary(new Error('mail me at a@b.co'))).toBe('mail me at [email]');
  });

  it('says when the alert channel is not configured', async () => {
    const outcome = await run(boom, db);
    expect(outcome.alert).toBe('not_configured');
  });
});
