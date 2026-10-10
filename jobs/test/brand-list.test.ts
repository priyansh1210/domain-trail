// Spec 010 tech §11 `brand-list.test.ts`: label extraction, filters, atomic swap (FR-REF-007).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Db, memoryDb } from '../_lib/db';
import { majesticCsv } from '../_lib/fixtures';
import { brandLabel, brandLabels, brandList, ordinaryWords } from '../brand-list';
import { fetchWith, one, run } from './support';

describe('brandLabel', () => {
  it('keeps the site name without its public suffix', () => {
    expect(brandLabel('flipkart.com')).toBe('flipkart');
    expect(brandLabel('zomato.co.in')).toBe('zomato');
    expect(brandLabel('Spotify.COM')).toBe('spotify');
  });

  it('leaves out ordinary words, plurals, word compounds, numbers and short names', () => {
    for (const domain of [
      'bookstore.com',
      'forms.gle',
      'petsupplies.com',
      'news.com',
      'gals4free.com',
      '123.com',
      'abc.com',
    ])
      expect(brandLabel(domain), domain).toBeUndefined();
    expect(ordinaryWords('supplies')).toBe(true);
    expect(ordinaryWords('zomato')).toBe(false);
  });

  it('keeps the best rank per name', () => {
    const lines = [
      'GlobalRank,TldRank,Domain,TLD',
      '5,1,zomato.com,com',
      '2,1,zomato.in,in',
      'x,1,broken,com',
    ];
    expect([...brandLabels(lines)]).toEqual([['zomato', 2]]);
  });

  it('rejects an unexpected file', () => {
    expect(() => brandLabels(['rank;domain', '1;a.com'])).toThrow(/header/);
  });
});

describe('brand-list job', () => {
  let db: Db;
  beforeAll(async () => {
    db = await memoryDb();
  });
  afterAll(async () => {
    await db?.close();
  });

  it('replaces the list in one go', async () => {
    await db.query(
      `insert into public.brand_labels (label, best_rank, source) values ('oldsite', 1, 'majestic')`,
    );
    const outcome = await run(brandList, db);
    expect(outcome.status).toBe('success');
    expect(await db.query(`select 1 from public.brand_labels where label = 'oldsite'`)).toEqual([]);
    const n = await one<{ n: number }>(db, `select count(*)::int as n from public.brand_labels`);
    expect(n.n).toBeGreaterThan(10_000);
    expect(
      await db.query(`select 1 from public.brand_labels where label in ('bookstore', 'zomato')`),
    ).toEqual([{ '?column?': 1 }]);
  });

  it('keeps the old list when the new one is too small', async () => {
    const before = await one<{ n: number }>(db, `select count(*)::int as n from public.brand_labels`);
    const small = majesticCsv(100);
    const outcome = await run(brandList, db, {
      fetch: fetchWith({ 'downloads.majestic.com': () => new Response(small) }),
    });
    expect(outcome.status).toBe('failed');
    expect(await one(db, `select count(*)::int as n from public.brand_labels`)).toEqual(before);
  });
});
