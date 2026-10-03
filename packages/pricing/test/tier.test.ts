// Spec 006 tech §11 `tier.test.ts` (FR-PRC-003): section boundaries in USD cents.
import { describe, expect, it } from 'vitest';
import { tierOf } from '../src/client';

describe('price sections', () => {
  it('puts each upfront price in the right section', () => {
    expect(tierOf(0)).toBe('free');
    expect(tierOf(1)).toBe('budget');
    expect(tierOf(10_000)).toBe('budget');
    expect(tierOf(10_001)).toBe('mid');
    expect(tierOf(30_000)).toBe('mid');
    expect(tierOf(30_001)).toBe('premium');
  });
});
