// Spec 006 tech §11 `tlds-in-band.test.ts` (FR-PRC-009): extensions priced in the chosen band, with neighbours.
import { describe, expect, it } from 'vitest';
import { type PriceBook, snapshotBook } from '../src/book';
import { tldsInBand } from '../src/price';

const book: PriceBook = {
  ...snapshotBook(),
  prices: new Map([
    ['com', { registerCents: 1108, renewCents: 1108 }],
    ['shop', { registerCents: 206, renewCents: 3141 }],
    ['io', { registerCents: 2812, renewCents: 5180 }],
    ['ai', { registerCents: 8270, renewCents: 8270 }],
  ]),
};

describe('tldsInBand', () => {
  it('picks extensions whose upfront price is in the band', () => {
    expect(tldsInBand(1000, 3000, ['com', 'shop', 'io', 'ai', 'fr'], book)).toEqual(['com', 'io']);
    // .ai is $165.40 upfront (2-year minimum) → $101–300 band
    expect(tldsInBand(10_001, 30_000, ['com', 'shop', 'io', 'ai'], book)).toEqual(['ai']);
    expect(tldsInBand(30_001, null, ['com', 'ai'], book)).toEqual([]);
  });

  it('includes near neighbours (±10 %)', () => {
    expect(tldsInBand(1200, 2600, ['com', 'io'], book)).toEqual(['com', 'io']);
  });
});
