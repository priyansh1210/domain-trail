// Spec 006 tech §11 `price-for.test.ts` (FR-PRC-001, 002, 012, 014, 015, 016).
import { describe, expect, it } from 'vitest';
import { type PriceBook, policyFor, snapshotBook } from '../src/book';
import { priceFor } from '../src/price';
import { PORKBUN } from '../src/sources';

const book: PriceBook = {
  ...snapshotBook(),
  prices: new Map([
    ['com', { registerCents: 1108, renewCents: 1108 }],
    ['shop', { registerCents: 206, renewCents: 3141 }],
    ['ai', { registerCents: 8270, renewCents: 8270 }],
    ['us', { registerCents: 443, renewCents: 700 }],
  ]),
};

describe('priceFor', () => {
  it('shows upfront, renewal, source and a Porkbun buy link', () => {
    expect(priceFor({ label: 'crumbly', tld: 'com', status: 'available' }, book)).toMatchObject({
      priced: true,
      upfrontUsdCents: 1108,
      renewUsdCents: 1108,
      tier: 'budget',
      source: 'Porkbun',
      buyUrl: PORKBUN.buyUrl('crumbly.com'),
      renewWarning: false,
    });
  });

  it('charges the whole minimum term upfront (.ai needs 2 years)', () => {
    expect(priceFor({ label: 'crumbly', tld: 'ai', status: 'available' }, book)).toMatchObject({
      upfrontUsdCents: 16_540,
      minYears: 2,
      tier: 'mid',
    });
  });

  it('warns when the renewal is more than twice the first year', () => {
    expect(priceFor({ label: 'crumbly', tld: 'shop', status: 'available' }, book)).toMatchObject({
      upfrontUsdCents: 206,
      renewWarning: true,
    });
  });

  it('uses a registry premium price when one is known, and flags short names that may be premium', () => {
    expect(
      priceFor(
        { label: 'crumbly', tld: 'shop', status: 'available_premium', premium: { registerCents: 45_000 } },
        book,
      ),
    ).toMatchObject({
      premium: true,
      tier: 'premium',
    });
    expect(priceFor({ label: 'loaf', tld: 'shop', status: 'available' }, book)).toMatchObject({
      premiumPossible: true,
    });
    expect(priceFor({ label: 'loaf', tld: 'com', status: 'available' }, book)).toMatchObject({
      premiumPossible: false,
    });
  });

  it('shows rules and restrictions before the visitor leaves', () => {
    expect(priceFor({ label: 'crumbly', tld: 'us', status: 'available' }, book)).toMatchObject({
      restriction: { kind: 'local_presence', note: policyFor('us').note },
    });
    expect(priceFor({ label: 'crumbly', tld: 'dev', status: 'available' }, book)).toMatchObject({
      requiresHttps: true,
    });
  });

  it('never invents a price: unknown extensions are unpriced', () => {
    expect(priceFor({ label: 'crumbly', tld: 'fr', status: 'available' }, book)).toEqual({
      priced: false,
      requiresHttps: false,
      restriction: { kind: 'local_presence', note: policyFor('fr').note },
    });
  });
});
