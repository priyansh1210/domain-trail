// Spec 012 tech §11 `money-time.test.ts` (FR-DATA-006).
import { describe, expect, it } from 'vitest';
import { convertCents, formatMoney, money, parseCents, utcNow } from '../src/money';

describe('money', () => {
  it('parses provider price strings into exact cents', () => {
    expect(parseCents('9.73')).toBe(973);
    expect(parseCents('10.5')).toBe(1050);
    expect(parseCents('1,234.00')).toBe(123400);
    expect(parseCents('0.1')).toBe(10); // no 0.1 float drift
    expect(() => parseCents('-1')).toThrow(RangeError);
    expect(() => parseCents('abc')).toThrow(RangeError);
  });

  it('rejects floats and non-ISO currencies', () => {
    expect(() => money(9.5, 'USD')).toThrow(RangeError);
    expect(() => money(950, 'usd')).toThrow(RangeError);
    expect(money(950, 'USD')).toEqual({ cents: 950, currency: 'USD' });
  });

  it('converts with whole-cent rounding', () => {
    expect(convertCents(973, 149.5)).toBe(145464); // $9.73 → ¥1,454.64 in hundredths
    expect(() => convertCents(100, 0)).toThrow(RangeError);
  });

  it('formats in the chosen currency', () => {
    expect(formatMoney(money(973, 'USD'))).toBe('$9.73');
    expect(formatMoney(money(145464, 'JPY'), 'en-US')).toBe('¥1,455');
  });
});

describe('time', () => {
  it('always uses UTC ISO strings', () => {
    expect(utcNow(new Date(Date.UTC(2026, 9, 3, 12, 0, 0)))).toBe('2026-10-03T12:00:00.000Z');
  });
});
