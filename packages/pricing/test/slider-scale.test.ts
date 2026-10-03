// Spec 006 tech §11 `slider-scale.test.ts` (FR-PRC-004, FR-PRC-018): position ↔ price, 1-2-5 style rounding, ∞.
import { describe, expect, it } from 'vitest';
import { inRange, positionToUsd, round125, SLIDER_STEPS, usdToPosition } from '../src/client';

describe('price range slider scale', () => {
  it('covers free to "$10,000+" with finer steps at low prices', () => {
    expect(positionToUsd(0)).toBe(0);
    expect(positionToUsd(SLIDER_STEPS)).toBe(Number.POSITIVE_INFINITY);
    expect(positionToUsd(250)).toBe(10);
    expect(positionToUsd(500)).toBe(100);
    expect(positionToUsd(750)).toBe(1000);
  });

  it('snaps to friendly steps', () => {
    expect(round125(7.4)).toBe(7);
    expect(round125(43)).toBe(45);
    expect(round125(612)).toBe(600);
    expect(round125(3330)).toBe(3300);
    expect(round125(7777)).toBe(7750);
  });

  it('maps prices back to positions', () => {
    expect(usdToPosition(0)).toBe(0);
    expect(usdToPosition(100)).toBe(500);
    expect(usdToPosition(Number.POSITIVE_INFINITY)).toBe(SLIDER_STEPS);
    expect(usdToPosition(20_000)).toBe(SLIDER_STEPS);
  });

  it('filters by range, including free names when the minimum is 0', () => {
    expect(inRange(0, 0, 50)).toBe(true);
    expect(inRange(1108, 10, 50)).toBe(true);
    expect(inRange(5001, 10, 50)).toBe(false);
    expect(inRange(500_000, 300, Number.POSITIVE_INFINITY)).toBe(true);
  });
});
