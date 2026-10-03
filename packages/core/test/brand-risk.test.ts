// Spec 014 tech §11 `brand-risk.test.ts` (FR-ABU-006, 007, 008; US-4): no brand look-alikes.
import { describe, expect, it } from 'vitest';
import { brandRisk, brandTokensIn, editDistance } from '../src/safety/brand-risk';

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
