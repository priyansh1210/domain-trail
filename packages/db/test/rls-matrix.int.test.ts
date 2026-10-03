// Spec 012 tech §4 access matrix, spec 011 tech §3/§5.6 (anonymous savers) and limit triggers.
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { as, createUser, migratedDb } from './support/pg';

const A = '0190f5a8-0000-7000-8000-00000000000a';
const B = '0190f5a8-0000-7000-8000-00000000000b';
const ANON = '0190f5a8-0000-7000-8000-0000000000ee';
const LIMITS = '0190f5a8-0000-7000-8000-0000000000ff';
const SEARCH = '0190f5a8-0000-7000-8000-000000000123';

const user = (sub: string) => ({ sub, role: 'authenticated' as const, is_anonymous: false });
const anonSaver = { sub: ANON, role: 'authenticated' as const, is_anonymous: true };
const visitor = { role: 'anon' as const };

let db: PGlite;
beforeAll(async () => {
  db = await migratedDb();
  for (const id of [A, B, LIMITS]) await createUser(db, id);
  await createUser(db, ANON, true);
  await db.exec(`
    insert into public.tlds (tld, type) values ('com', 'gTLD');
    insert into public.searches (id, cache_key, status, prefs, pipeline_version, expires_at)
      values ('${SEARCH}', 'k', 'done', '{}', '0.1.0', now() + interval '7 days');`);
});
afterAll(async () => {
  await db?.close();
});

describe('browser roles', () => {
  it('lets anyone read public reference data (FR-DATA-005)', async () => {
    const rows = await as(db, visitor, (tx) => tx.query('select tld from public.tlds'));
    expect(rows.rows).toEqual([{ tld: 'com' }]);
  });

  it('hides server-only tables from the browser', async () => {
    const rows = await as(db, visitor, (tx) => tx.query('select id from public.searches'));
    expect(rows.rows).toEqual([]);
    await expect(
      as(db, visitor, (tx) =>
        tx.query(`insert into public.domain_checks (fqdn, tld, status, method, checked_at, expires_at)
                  values ('x.com', 'com', 'available', 'rdap', now(), now())`),
      ),
    ).rejects.toThrow(/row-level security/);
  });
});

describe('own rows only (FR-DATA-004)', () => {
  it("keeps one user's watchlist invisible to another", async () => {
    await as(db, user(A), (tx) =>
      tx.query(`insert into public.watchlist (user_id, fqdn) values ($1, 'a.com')`, [A]),
    );
    const mine = await as(db, user(A), (tx) => tx.query('select fqdn from public.watchlist'));
    const theirs = await as(db, user(B), (tx) => tx.query('select fqdn from public.watchlist'));
    expect(mine.rows).toEqual([{ fqdn: 'a.com' }]);
    expect(theirs.rows).toEqual([]);
  });

  it('refuses rows written on behalf of someone else', async () => {
    await expect(
      as(db, user(B), (tx) =>
        tx.query(`insert into public.watchlist (user_id, fqdn) values ($1, 'b.com')`, [A]),
      ),
    ).rejects.toThrow(/row-level security/);
  });
});

describe('signed-out savers (spec 011 FR-ACC-017)', () => {
  const save = (description: string | null) =>
    as(db, anonSaver, (tx) =>
      tx.query(
        `insert into public.saved_searches (user_id, title, description, preferences, search_id)
         values ($1, 'My search', $2, '{}', $3)`,
        [ANON, description, SEARCH],
      ),
    );

  it('can save searches and names without a description', async () => {
    await save(null);
    await as(db, anonSaver, (tx) =>
      tx.query(`insert into public.watchlist (user_id, fqdn) values ($1, 'c.com')`, [ANON]),
    );
    const rows = await as(db, anonSaver, (tx) => tx.query('select title from public.saved_searches'));
    expect(rows.rows).toEqual([{ title: 'My search' }]);
  });

  it('can never store a description (constitution P5)', async () => {
    await expect(save('Neighborhood bakery delivering sourdough bread and cakes')).rejects.toThrow(
      /row-level security/,
    );
  });

  it('cannot create an account profile', async () => {
    await expect(
      as(db, anonSaver, (tx) =>
        tx.query(
          `insert into public.profiles (user_id, terms_version, terms_accepted_at, age_confirmed)
           values ($1, 'v1', now(), true)`,
          [ANON],
        ),
      ),
    ).rejects.toThrow(/row-level security/);
  });
});

describe('limits (spec 011 FR-ACC-004)', () => {
  it('allows 20 saved searches and refuses the 21st', async () => {
    await as(db, user(LIMITS), async (tx) => {
      for (let i = 0; i < 20; i++) {
        await tx.query(
          `insert into public.saved_searches (user_id, title, preferences) values ($1, $2, '{}')`,
          [LIMITS, `s${i}`],
        );
      }
    });
    await expect(
      as(db, user(LIMITS), (tx) =>
        tx.query(`insert into public.saved_searches (user_id, title, preferences) values ($1, 's21', '{}')`, [
          LIMITS,
        ]),
      ),
    ).rejects.toThrow(/limit_reached/);
  });
});

describe('RPCs (service role only)', () => {
  it('refuses budget writes from the browser', async () => {
    await expect(
      as(db, user(A), (tx) => tx.query(`select public.jev_usage_add(current_date, 100, 1, false)`)),
    ).rejects.toThrow(/permission denied/);
  });

  it('adds usage atomically for the server', async () => {
    await db.transaction(async (tx) => {
      await tx.exec('set local role service_role');
      await tx.query(`select public.jev_usage_add('2026-10-03', 15000, 4, false)`);
      await tx.query(`select public.jev_usage_add('2026-10-03', 5000, 2, true)`);
    });
    const { rows } = await db.query<{ total: string }>(
      `select public.month_jev_tokens('2026-10-15') as total`,
    );
    expect(Number(rows[0]?.total)).toBe(20000);
    const day = await db.query(
      `select searches, degraded_searches from public.jev_usage where day = '2026-10-03'`,
    );
    expect(day.rows).toEqual([{ searches: 2, degraded_searches: 1 }]);
  });
});
