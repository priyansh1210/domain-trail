// Spec 001 tech §11 `normalize.test.ts` (FR-INT-007, FR-INT-011).
import { describe, expect, it } from 'vitest';
import { normalize } from '../src/intake/normalize';

describe('normalize', () => {
  it('removes invisible and control characters and collapses spaces', () => {
    expect(normalize('  sour\u200Bdough\u00AD   bread\u0007 \n\t shop ').text).toBe('sourdough bread shop');
  });

  it('applies Unicode NFKC normalization', () => {
    expect(normalize('ｃａｆｅ').text).toBe('cafe');
  });

  it('removes links, e-mail addresses and phone numbers and reports it', () => {
    const r = normalize('Bakery at www.example.com, mail hello@example.com or call +1 (555) 010-9999 today');
    expect(r.text).toBe('Bakery at mail or call today');
    expect(r.removed).toEqual({ url: true, email: true, phone: true });
  });

  it('keeps short numbers such as 24x7 or a year', () => {
    const r = normalize('24x7 help desk since 2020');
    expect(r.text).toBe('24x7 help desk since 2020');
    expect(r.removed.phone).toBe(false);
  });

  it('keeps non-Latin scripts intact', () => {
    expect(normalize('पुणे में ताज़ी ब्रेड की बेकरी').text).toBe('पुणे में ताज़ी ब्रेड की बेकरी');
  });

  it('stays fast on hostile input (CodeQL js/polynomial-redos)', () => {
    const t0 = performance.now();
    normalize('+'.repeat(16_000));
    normalize(`${'1'.repeat(16_000)}x`);
    normalize('a.'.repeat(8_000));
    expect(performance.now() - t0).toBeLessThan(100);
  });
});
