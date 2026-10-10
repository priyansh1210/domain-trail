// Spec 010 tech §11 `nrd-ingest.int.test.ts`: invalidation, watcher flags, trends, idempotent re-run, back-fill of
// missed days, nothing stored beyond aggregates (FR-REF-003, 004, 005).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Db, memoryDb } from '../_lib/db';
import { nrdNames, nrdZip } from '../_lib/fixtures';
import { computeTrends, nrdIngest, nrdUrl, parseNrdZip } from '../nrd-ingest';
import { fetchWith, one, run } from './support';

let db: Db;
const USER = '0190f5a8-0000-7000-8000-00000000000a';
const now = new Date('2026-10-10T02:00:00Z');

beforeAll(async () => {
  db = await memoryDb();
  await db.query(`insert into auth.users (id) values ($1)`, [USER]);
  await db.query(`insert into public.tlds (tld, type) values ('com', 'gTLD'), ('shop', 'gTLD')`);
  await db.query(
    `insert into public.domain_checks (fqdn, tld, status, method, checked_at, expires_at) values
       ('sunnycrust.shop', 'shop', 'available', 'rdap', now(), now() + interval '6 hours'),
       ('quietfox.com', 'com', 'available', 'rdap', now(), now() + interval '6 hours')`,
  );
  await db.query(
    `insert into public.watchlist (user_id, fqdn, last_status) values ($1, 'sunnycrust.shop', 'available')`,
    [USER],
  );
});
afterAll(async () => {
  await db?.close();
});

/** whoisds answers per requested day (the file name is base64 in the URL). */
function whoisds(days: Record<string, string[] | 'missing'>) {
  const asked: string[] = [];
  const fetchFn = fetchWith({
    'www.whoisds.com': (url) => {
      const encoded = url.pathname.split('/').at(-2) ?? '';
      const day = Buffer.from(encoded, 'base64').toString().replace('.zip', '');
      asked.push(day);
      const names = days[day];
      if (!names || names === 'missing') return new Response('<html>no file</html>', { status: 200 });
      return new Response(nrdZip(names));
    },
  });
  return { asked, fetchFn };
}

describe('parsing', () => {
  it('builds the whoisds URL from the base64 file name', () => {
    expect(nrdUrl('2026-10-09')).toBe(
      'https://www.whoisds.com//whois-database/newly-registered-domains/MjAyNi0xMC0wOS56aXA=/nrd',
    );
  });

  it('reads distinct, lower-case names and rejects short or broken files', () => {
    const names = parseNrdZip(nrdZip([...nrdNames(1200), 'SunnyCrust.SHOP', 'not a name']));
    expect(names).toContain('sunnycrust.shop');
    expect(names).not.toContain('not a name');
    expect(() => parseNrdZip(nrdZip(['a.com']))).toThrow(/only 1 names/);
  });

  it('counts words, first and last words and extensions; junk labels count only the extension', () => {
    const t = computeTrends(['sunnybakery.com', 'cloudbakery.shop', 'xq7zk1v.com']);
    expect(t.token.get('bakery')).toBe(2);
    expect(t.suffix.get('bakery')).toBe(2);
    expect(t.prefix.get('sunny')).toBe(1);
    expect(t.tld.get('com')).toBe(2);
  });
});

describe('nrd-ingest job', () => {
  const day1 = '2026-10-09';
  const list = [...nrdNames(1500), 'sunnycrust.shop'];

  it('marks cached available names as taken and tells watchers', async () => {
    const { fetchFn } = whoisds({
      [day1]: list,
      '2026-10-08': list,
      '2026-10-07': 'missing',
      '2026-10-06': 'missing',
    });
    const outcome = await run(nrdIngest, db, { now, fetch: fetchFn });
    expect(outcome.status).toBe('success');
    expect(outcome.stats).toMatchObject({ daysProcessed: 2, notPublished: '2026-10-06,2026-10-07' });
    expect(
      await one(db, `select status, method from public.domain_checks where fqdn = 'sunnycrust.shop'`),
    ).toEqual({
      status: 'taken',
      method: 'nrd',
    });
    expect(await one(db, `select status from public.domain_checks where fqdn = 'quietfox.com'`)).toEqual({
      status: 'available',
    });
    const notes = await db.query(`select kind, fqdn from public.notifications where user_id = $1`, [USER]);
    expect(notes).toEqual([{ kind: 'registered', fqdn: 'sunnycrust.shop' }]);
    expect(await one(db, `select last_status from public.watchlist where fqdn = 'sunnycrust.shop'`)).toEqual({
      last_status: 'taken',
    });
  });

  it('stores only aggregates — no table holds the list itself (FR-REF-005)', async () => {
    const kinds = await db.query(`select distinct kind from public.keyword_trends order by kind`);
    expect(kinds.map((k) => (k as { kind: string }).kind)).toEqual(['prefix', 'suffix', 'tld', 'token']);
    const tables = await db.query<{ table_name: string; n: number }>(
      `select table_name, (xpath('/row/n/text()', query_to_xml(format('select count(*) as n from public.%I', table_name), false, true, '')))[1]::text::int as n
       from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE'`,
    );
    const big = tables.filter((t) => t.n >= 1000 && t.table_name !== 'keyword_trends');
    expect(big).toEqual([]);
  });

  it('skips days already processed and is safe to run again', async () => {
    const { asked, fetchFn } = whoisds({ '2026-10-07': 'missing', '2026-10-06': 'missing' });
    const outcome = await run(nrdIngest, db, { now, fetch: fetchFn });
    expect(outcome.status).toBe('success');
    expect(asked.sort()).toEqual(['2026-10-06', '2026-10-07']);
    const notes = await one<{ n: number }>(db, `select count(*)::int as n from public.notifications`);
    expect(notes.n).toBe(1);
  });

  it('back-fills a missed day once it is published', async () => {
    const { fetchFn } = whoisds({ '2026-10-07': list, '2026-10-06': 'missing' });
    const outcome = await run(nrdIngest, db, { now, fetch: fetchFn });
    expect(outcome.stats).toMatchObject({ daysProcessed: 1 });
    const days = await db.query(`select distinct day::text as day from public.keyword_trends order by day`);
    expect(days).toEqual([{ day: '2026-10-07' }, { day: '2026-10-08' }, { day: '2026-10-09' }]);
  });

  it('fails when recent days stay missing', async () => {
    const fresh = await memoryDb();
    const { fetchFn } = whoisds({});
    const outcome = await run(nrdIngest, fresh, { now, fetch: fetchFn });
    expect(outcome.status).toBe('failed');
    await fresh.close();
  });
});
