// Spec 014 tech §11 `brand-risk.test.ts` (FR-ABU-006, 007, 008; US-4): no brand look-alikes.
import { afterAll, describe, expect, it } from 'vitest';
import { brandRisk, brandTokensIn, editDistance, setPopularBrands } from '../src/safety/brand-risk';

const risky = (label: string, opts = {}) => brandRisk(label, opts).risky;

describe('brand risk', () => {
  it('blocks exact brands, names containing them and one-typo copies', () => {
    expect(brandRisk('paypal')).toMatchObject({ risky: true, rule: 'exact' });
    expect(brandRisk('flipkartdeals')).toMatchObject({ risky: true, rule: 'contains' });
    expect(brandRisk('paypall')).toMatchObject({ risky: true });
    expect(brandRisk('gooogle')).toMatchObject({ risky: true, rule: 'typo' });
  });

  it('reads digits and look-alike letters the way people do (0/o, 1/l, rn/m)', () => {
    expect(risky('g00gle')).toBe(true);
    expect(risky('paypa1')).toBe(true);
    expect(risky('arnazon')).toBe(true);
  });

  it('blocks brand + account/security words, even for brands that are ordinary words', () => {
    expect(brandRisk('applelogin', { segments: ['apple', 'login'] })).toMatchObject({
      risky: true,
      rule: 'combo',
    });
    expect(brandRisk('hdfcsecure', { segments: ['hdfc', 'secure'] })).toMatchObject({ risky: true });
  });

  it('allows ordinary words that happen to be brands, used normally', () => {
    expect(risky('appleorchard', { segments: ['apple', 'orchard'] })).toBe(false);
    expect(risky('zoomlearn', { segments: ['zoom', 'learn'] })).toBe(false);
    expect(risky('sunnycrust')).toBe(false);
    expect(risky('breadhub')).toBe(false);
  });

  it('is stricter when the description asks to imitate a brand', () => {
    expect(risky('appleorchard', { strict: true, segments: ['apple', 'orchard'] })).toBe(true);
    expect(risky('ebooksnow', { descBrandTokens: ['ebay'] })).toBe(false);
    expect(risky('amazonbooks', { descBrandTokens: ['amazon'] })).toBe(true);
  });

  it('finds brand words mentioned in a description', () => {
    expect(brandTokensIn('Like Amazon but for used books')).toEqual(['amazon']);
    expect(brandTokensIn('An apple orchard selling cider')).toEqual([]);
    expect(brandTokensIn('Recipes inspired by Apple pie')).toEqual(['apple']);
  });

  it('computes edit distance with transpositions', () => {
    expect(editDistance('paypal', 'papyal')).toBe(1);
    expect(editDistance('google', 'gogole')).toBe(1);
    expect(editDistance('abc', 'xyz', 1)).toBe(2);
  });
});

describe('popular-site names from the weekly list (spec 010 §5.4)', () => {
  afterAll(() => setPopularBrands([]));

  it('blocks names equal to, containing or one typo away from a popular site', () => {
    expect(risky('kelvarodeals')).toBe(false);
    setPopularBrands(['kelvaro', 'zimbuto', 'pravix']);
    expect(brandRisk('kelvaro')).toMatchObject({ risky: true, rule: 'exact' });
    expect(brandRisk('kelvarodeals')).toMatchObject({ risky: true, rule: 'contains', brand: 'kelvaro' });
    expect(brandRisk('zimbtuo')).toMatchObject({ risky: true, rule: 'typo', brand: 'zimbuto' });
    expect(risky('freshbakes')).toBe(false);
  });

  it('keeps description brand tokens to the curated list', () => {
    setPopularBrands(['kelvaro']);
    expect(brandTokensIn('A food blog, not like Kelvaro')).toEqual([]);
  });

  it('stays fast with 50,000 names (spec 014 §10: 1,000 labels < 100 ms)', () => {
    const letters = 'bdfgklmnprstvz';
    const vowels = 'aeiou';
    let seed = 1;
    const rand = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    const coin = () =>
      Array.from(
        { length: 3 },
        () => letters[Math.floor(rand() * 14)]! + vowels[Math.floor(rand() * 5)]!,
      ).join('');
    setPopularBrands(Array.from({ length: 50_000 }, coin));
    brandRisk('warmup');
    const labels = Array.from({ length: 1000 }, (_, i) => `${coin()}${i % 7 ? 'shop' : ''}`);
    const t0 = performance.now();
    for (const l of labels) brandRisk(l, { segments: [l] });
    expect(performance.now() - t0).toBeLessThan(250);
  });
});
