// Spec 011 tech §11 `watchlist-job.int.test.ts`: status and price changes → the right in-app notifications;
// signed-out savers are skipped; nothing is repeated on a second run (FR-ACC-006, 007).
import { fixtureFetch as availabilityFixture, fixtureTaken } from '@domains-all/availability';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Db, memoryDb } from '../_lib/db';
import { fixtureFetch } from '../_lib/fixtures';
import { changes, watchlist } from '../watchlist';
import { one, run } from './support';

const USER = '0190f5a8-0000-7000-8000-00000000000a';
const ANON = '0190f5a8-0000-7000-8000-0000000000ee';
const SEARCH = '0190f5a8-0000-7000-8000-000000000123';

/** DNS and registry answers from the availability fixtures (taken by a fixed hash); everything else as usual. */
const fetchFn = (async (input, init) => {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
  if (url.host === 'cloudflare-dns.com' || url.host === 'dns.google' || /\/domain\//.test(url.pathname))
    return availabilityFixture(input, init);
  return fixtureFetch(input, init);
}) as typeof fetch;

/** A free name in the fixture world for each extension. */
const freeName = (tld: string, from = 0) => {
  for (let i = from; ; i++) if (!fixtureTaken(`quietfox${i}.${tld}`)) return `quietfox${i}.${tld}`;
};

let db: Db;
const taken = 'bakery.com'; // always taken in the fixture world
const nowFree = freeName('com');
const priced = freeName('shop');

beforeAll(async () => {
  db = await memoryDb();
  await db.query(`insert into auth.users (id, is_anonymous) values ($1, false), ($2, true)`, [USER, ANON]);
  await db.query(`insert into public.tlds (tld, type) values ('com', 'gTLD'), ('shop', 'gTLD')`);
  await db.query(
    `insert into public.tld_prices (tld, provider, register_cents, renew_cents, fetched_at)
     values ('com', 'porkbun', 1108, 1108, now()), ('shop', 'porkbun', 206, 3141, now())`,
  );
  await db.query(
    `insert into public.watchlist (user_id, fqdn, notify_on, last_status, last_upfront_cents) values
       ($1, $3, '{status_change}', 'available', 1108),
       ($1, $4, '{status_change}', 'taken', null),
       ($1, $5, '{status_change,price_change}', 'available', 100),
       ($2, $3, '{status_change}', 'available', 1108)`,
    [USER, ANON, taken, nowFree, priced],
  );
  await db.query(
    `insert into public.searches (id, cache_key, status, prefs, pipeline_version, expires_at)
     values ($1, 'k', 'done', '{}', '0.1.0', now() + interval '7 days')`,
    [SEARCH],
  );
  await db.query(
    `insert into public.search_results (search_id, fqdn, section, rank, score, status, upfront_cents, signals, reasons, strategy)
     values ($1, $2, 'budget', 0, 0.9, 'available', 1108, '{}', '[]', 'x')`,
    [SEARCH, taken],
  );
  await db.query(
    `insert into public.saved_searches (user_id, title, preferences, search_id, alerts_enabled) values ($1, 'Mine', '{}', $2, true)`,
    [USER, SEARCH],
  );
});
afterAll(async () => {
  await db?.close();
});

describe('changes', () => {
  it('maps status and price moves to alert kinds', () => {
    expect(
      changes({ status: 'available', upfrontCents: 100 }, { status: 'taken', upfrontCents: null }, true),
    ).toEqual(['registered']);
    expect(
      changes(
        { status: 'taken', upfrontCents: null },
        { status: 'likely_available', upfrontCents: 900 },
        false,
      ),
    ).toEqual(['available']);
    expect(
      changes({ status: 'available', upfrontCents: 1000 }, { status: 'available', upfrontCents: 1090 }, true),
    ).toEqual([]);
    expect(
      changes({ status: 'available', upfrontCents: 1000 }, { status: 'available', upfrontCents: 1100 }, true),
    ).toEqual(['price_change']);
    expect(
      changes({ status: null, upfrontCents: null }, { status: 'taken', upfrontCents: null }, true),
    ).toEqual([]);
    expect(
      changes({ status: 'available', upfrontCents: 1 }, { status: 'unknown', upfrontCents: null }, true),
    ).toEqual([]);
  });
});

describe('watchlist job', () => {
  it('turns changes into notifications for signed-in users only', async () => {
    const outcome = await run(watchlist, db, { fetch: fetchFn });
    expect(outcome.status).toBe('success');
    const notes = await db.query<{ user_id: string; kind: string; fqdn: string }>(
      `select user_id::text, kind, fqdn from public.notifications order by kind, fqdn`,
    );
    expect(notes).toEqual(
      expect.arrayContaining([
        { user_id: USER, kind: 'registered', fqdn: taken },
        { user_id: USER, kind: 'available', fqdn: nowFree },
        { user_id: USER, kind: 'price_change', fqdn: priced },
      ]),
    );
    // The saved search's top result is the same name as a watched one: still one notification.
    expect(notes.filter((n) => n.fqdn === taken)).toHaveLength(1);
    expect(notes.some((n) => n.user_id === ANON)).toBe(false);
    expect(
      await one(db, `select last_status::text from public.watchlist where user_id = $1 and fqdn = $2`, [
        USER,
        taken,
      ]),
    ).toEqual({
      last_status: 'taken',
    });
    expect(await one(db, `select status from public.search_results where fqdn = $1`, [taken])).toEqual({
      status: 'taken',
    });
  });

  it('does not repeat alerts on a second run', async () => {
    const before = await one<{ n: number }>(db, `select count(*)::int as n from public.notifications`);
    await run(watchlist, db, { fetch: fetchFn });
    expect(await one(db, `select count(*)::int as n from public.notifications`)).toEqual(before);
  });
});
