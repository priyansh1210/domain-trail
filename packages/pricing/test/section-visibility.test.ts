// Spec 006 tech §11 `section-visibility.test.ts` (FR-PRC-003, FR-PRC-010): $300+ hidden when empty without a
// premium/resale source; labels in other currencies, boundaries still in USD.
import { describe, expect, it } from 'vitest';
import { type FxTable, formatMoney, sectionLabel, showPremiumSection } from '../src/client';

const fx: FxTable = {
  base: 'USD',
  asOf: '2026-10-02',
  rates: { USD: 1, JPY: 157.67, INR: 96.32, EUR: 0.89087 },
};

describe('the $300+ section', () => {
  it('is hidden when empty and no premium or resale source is configured', () => {
    expect(showPremiumSection(0, { premiumProviders: [], aftermarketProviders: [] })).toBe(false);
    expect(showPremiumSection(2, { premiumProviders: [], aftermarketProviders: [] })).toBe(true);
    expect(showPremiumSection(0, { premiumProviders: ['porkbun-check'], aftermarketProviders: [] })).toBe(
      true,
    );
  });
});

describe('section labels and money in the chosen currency', () => {
  it('labels sections by price range only', () => {
    expect(sectionLabel('free', 'USD', fx)).toBe('Free');
    expect(sectionLabel('budget', 'USD', fx)).toBe('$1–100');
    expect(sectionLabel('mid', 'USD', fx)).toBe('$101–300');
    expect(sectionLabel('premium', 'USD', fx)).toBe('$300+');
  });

  it('converts labels and prices approximately (yen and rupees)', () => {
    expect(sectionLabel('budget', 'JPY', fx)).toBe('≈ ¥160–16,000');
    expect(formatMoney(973, 'USD', fx)).toBe('$9.73');
    expect(formatMoney(973, 'JPY', fx)).toBe('≈ ¥1,534');
    expect(formatMoney(173, 'INR', fx)).toBe('≈ ₹167');
  });

  it('falls back to US dollars when a rate is missing', () => {
    expect(formatMoney(973, 'XYZ', fx)).toBe('$9.73');
    expect(sectionLabel('budget', 'XYZ', fx)).toBe('$1–100');
  });
});
