// Spec 006 tech §11 `refresh-prices.int.test.ts`: upsert + history on change only; a failed sanity check keeps
// yesterday's data (FR-REF-002, FR-PRC-011).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Db, memoryDb } from '../_lib/db';
import { porkbunPricing } from '../_lib/fixtures';
import { refreshPrices } from '../refresh-prices';
import { fetchWith, one, run } from './support';

let db: Db;
beforeAll(async () => {
  db = await memoryDb();
});
afterAll(async () => {
  await db?.close();
});

const count = async (table: string) =>
  (await one<{ n: number }>(db, `select count(*)::int as n from ${table}`)).n;

describe('refresh-prices job', () => {
  it('stores prices, currency rates and extension policies', async () => {
    const outcome = await run(refreshPrices, db);
    expect(outcome.status).toBe('success');
    const com = await one<{ register_cents: number; currency: string }>(
      db,
      `select register_cents, currency from public.tld_prices where tld = 'com' and provider = 'porkbun'`,
    );
    expect(com.currency).toBe('USD');
    expect(com.register_cents).toBeGreaterThan(500);
    expect(await one(db, `select priced from public.tlds where tld = 'com'`)).toEqual({ priced: true });
    expect(await count('public.fx_rates')).toBeGreaterThan(20);
    expect(await one(db, `select min_years from public.tld_policies where tld = 'ai'`)).toEqual({
      min_years: 2,
    });
  });

  it('adds history only when a price changed', async () => {
    const history = await count('public.tld_price_history');
    expect((await run(refreshPrices, db)).stats).toMatchObject({ priceChanges: 0 });
    expect(await count('public.tld_price_history')).toBe(history);

    const changed = porkbunPricing();
    changed.pricing.xyz!.registration = '99.99';
    const outcome = await run(refreshPrices, db, {
      fetch: fetchWith({ 'api.porkbun.com': () => Response.json(changed) }),
    });
    expect(outcome.stats).toMatchObject({ priceChanges: 1 });
    expect(await one(db, `select register_cents from public.tld_prices where tld = 'xyz'`)).toEqual({
      register_cents: 9999,
    });
    const xyz = await db.query(
      `select register_cents from public.tld_price_history where tld = 'xyz' order by changed_at`,
    );
    expect(xyz.at(-1)).toEqual({ register_cents: 9999 });
  });

  it('keeps yesterday’s prices when the list fails its sanity check', async () => {
    const before = await one(
      db,
      `select register_cents, fetched_at from public.tld_prices where tld = 'com'`,
    );
    const broken = { status: 'SUCCESS', pricing: { com: { registration: '9.99', renewal: '9.99' } } };
    const outcome = await run(refreshPrices, db, {
      fetch: fetchWith({ 'api.porkbun.com': () => Response.json(broken) }),
    });
    expect(outcome.status).toBe('failed');
    expect(outcome.error).toMatch(/sanity check.*previous data kept/);
    expect(
      await one(db, `select register_cents, fetched_at from public.tld_prices where tld = 'com'`),
    ).toEqual(before);
  });

  it('still saves currency rates when only the price list fails', async () => {
    await db.query(`delete from public.fx_rates`);
    const outcome = await run(refreshPrices, db, {
      fetch: fetchWith({ 'api.porkbun.com': () => new Response('down', { status: 503 }) }),
    });
    expect(outcome.status).toBe('failed');
    expect(await count('public.fx_rates')).toBeGreaterThan(20);
  });

  it('removes prices of extensions the registrar stopped selling', async () => {
    const fewer = porkbunPricing();
    delete fewer.pricing.zip;
    await run(refreshPrices, db, { fetch: fetchWith({ 'api.porkbun.com': () => Response.json(fewer) }) });
    expect(await db.query(`select tld from public.tld_prices where tld = 'zip'`)).toEqual([]);
    expect(await one(db, `select priced from public.tlds where tld = 'zip'`)).toEqual({ priced: false });
  });
});
