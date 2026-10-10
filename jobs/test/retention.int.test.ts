// Spec 012 tech §11 `retention.int.test.ts`: §5.2 deletes exactly the expired rows; saved-search-linked searches
// survive; idle anonymous savers are removed (FR-DATA-003, FR-REF-010).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Db, memoryDb } from '../_lib/db';
import { cleanup, retentionStatements } from '../cleanup';
import { one, run } from './support';

let db: Db;
const KEEP = '0190f5a8-0000-7000-8000-000000000001';
const OLD = '0190f5a8-0000-7000-8000-000000000002';
const SAVED = '0190f5a8-0000-7000-8000-000000000003';
const USER = '0190f5a8-0000-7000-8000-00000000000a';
const IDLE_ANON = '0190f5a8-0000-7000-8000-0000000000ee';

beforeAll(async () => {
  db = await memoryDb();
  await db.query(`insert into auth.users (id, is_anonymous) values ($1, false), ($2, true)`, [
    USER,
    IDLE_ANON,
  ]);
  await db.query(
    `insert into public.anon_visitors (user_id, last_seen_at) values ($1, now() - interval '91 days')`,
    [IDLE_ANON],
  );
  await db.query(`insert into public.tlds (tld, type) values ('com', 'gTLD')`);
  const search = (id: string, age: string) =>
    db.query(
      `insert into public.searches (id, cache_key, status, prefs, pipeline_version, created_at, expires_at)
       values ($1, 'k', 'done', '{}', '0.1.0', now() - $2::interval, now() - $2::interval + interval '7 days')`,
      [id, age],
    );
  await search(KEEP, '2 days');
  await search(OLD, '8 days');
  await search(SAVED, '8 days');
  await db.query(
    `insert into public.saved_searches (user_id, title, preferences, search_id) values ($1, 'Mine', '{}', $2)`,
    [USER, SAVED],
  );
  await db.query(
    `insert into public.search_results (search_id, fqdn, section, rank, score, status, signals, reasons, strategy)
     values ($1, 'a.com', 'budget', 0, 1, 'available', '{}', '[]', 'x')`,
    [OLD],
  );
  await db.query(
    `insert into public.domain_checks (fqdn, tld, status, method, checked_at, expires_at) values
       ('gone.com', 'com', 'taken', 'rdap', now() - interval '40 days', now() - interval '31 days'),
       ('grace.com', 'com', 'taken', 'rdap', now() - interval '10 days', now() - interval '3 days')`,
  );
  await db.query(
    `insert into public.job_runs (job, run_date, status, started_at) values
       ('cleanup', current_date - 100, 'success', now() - interval '100 days'),
       ('cleanup', current_date - 10, 'success', now() - interval '10 days')`,
  );
  await db.query(
    `insert into public.feedback (search_id, fqdn, visitor_hash, vote, created_at) values
       ($1, 'a.com', 'h1', 1, now() - interval '15 months'), ($1, 'a.com', 'h2', 1, now())`,
    [KEEP],
  );
});
afterAll(async () => {
  await db?.close();
});

describe('retention', () => {
  it('lists a rule for every dataset with a retention period', () => {
    expect(retentionStatements(false).map(([n]) => n)).toEqual(
      expect.arrayContaining(['searches', 'domain_checks', 'anonymous_savers', 'feedback', 'job_runs']),
    );
  });

  it('deletes exactly the expired rows', async () => {
    const outcome = await run(cleanup, db);
    expect(outcome.status).toBe('success');
    const searches = await db.query<{ id: string }>(`select id from public.searches order by id`);
    expect(searches.map((s) => s.id)).toEqual([KEEP, SAVED]); // the saved one survives
    expect(await db.query(`select 1 from public.search_results`)).toEqual([]); // cascaded with OLD
    expect(await db.query(`select fqdn from public.domain_checks`)).toEqual([{ fqdn: 'grace.com' }]);
    expect(
      (
        await one<{ n: number }>(
          db,
          `select count(*)::int as n from public.job_runs where job = 'cleanup'
      and started_at < now() - interval '90 days'`,
        )
      ).n,
    ).toBe(0);
    expect(await db.query(`select visitor_hash from public.feedback`)).toEqual([{ visitor_hash: 'h2' }]);
  });

  it('removes signed-out savers idle for 90 days, with their saved items', async () => {
    expect(await db.query(`select 1 from auth.users where id = $1`, [IDLE_ANON])).toEqual([]);
    expect(await db.query(`select 1 from auth.users where id = $1`, [USER])).toEqual([{ '?column?': 1 }]);
  });

  it('uses shorter periods when the database is large', () => {
    const normal = retentionStatements(false).find(([n]) => n === 'domain_checks')![1];
    const tight = retentionStatements(true).find(([n]) => n === 'domain_checks')![1];
    expect(normal).toContain("'30 days'");
    expect(tight).toContain("'14 days'");
  });
});
