// Spec 015 tech §11 `meters.test.ts`: thresholds, projection math (FR-OBS-003, 004).
import { describe, expect, it } from 'vitest';
import { crossedThreshold, meterAlerts, monthProjection } from '../src';

describe('crossedThreshold', () => {
  it('returns the highest threshold reached', () => {
    expect(crossedThreshold(49, 100)).toBeUndefined();
    expect(crossedThreshold(50, 100)).toBe(0.5);
    expect(crossedThreshold(80, 100)).toBe(0.8);
    expect(crossedThreshold(130, 100)).toBe(1);
  });

  it('ignores meters without a limit', () => {
    expect(crossedThreshold(10, 0)).toBeUndefined();
  });
});

describe('monthProjection', () => {
  it('scales usage so far to the whole month (UTC)', () => {
    expect(monthProjection(10, new Date('2026-10-10T12:00:00Z'))).toBeCloseTo(31);
    expect(monthProjection(14, new Date('2026-02-14T00:00:00Z'))).toBeCloseTo(28);
  });
});

describe('meterAlerts', () => {
  const now = new Date('2026-10-10T05:00:00Z');

  it('maps 50 / 80 / 100 % to info / warning / critical', () => {
    const levels = meterAlerts(
      [
        { resource: 'a', used: 55, limit: 100, period: 'now' },
        { resource: 'b', used: 85, limit: 100, period: 'now' },
        { resource: 'c', used: 100, limit: 100, period: 'now' },
      ],
      now,
    ).map((a) => [a.key, a.level]);
    expect(levels).toEqual([
      ['budget-a-50', 'info'],
      ['budget-b-80', 'warning'],
      ['budget-c-100', 'critical'],
    ]);
  });

  it('warns about a monthly meter on course to pass its limit', () => {
    // 40 % used on day 10 of 31 → projection 124 %.
    const alerts = meterAlerts([{ resource: 'jev-tokens', used: 40, limit: 100, period: 'month' }], now);
    expect(alerts).toEqual([
      expect.objectContaining({ key: 'budget-jev-tokens-projected', level: 'warning' }),
    ]);
  });

  it('stays quiet when usage is low', () => {
    expect(meterAlerts([{ resource: 'db', used: 10, limit: 500, period: 'now' }], now)).toEqual([]);
  });
});
