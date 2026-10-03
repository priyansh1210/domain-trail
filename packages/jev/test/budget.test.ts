// Spec 002 tech §11 `budget.test.ts` (FR-JEV-008, FR-JEV-009).
import { describe, expect, it } from 'vitest';
import { BudgetGuard, MemoryUsageStore } from '../src/budget';

describe('budget guard', () => {
  const now = () => Date.UTC(2026, 9, 3, 12);

  it('blocks a search that would cross the daily or monthly cap', async () => {
    const store = new MemoryUsageStore();
    await store.addSearch({ day: '2026-10-03', tokens: 3_990_000, requests: 1, degraded: false });
    const guard = new BudgetGuard(store, { monthlyTokens: 100_000_000, dailyTokens: 4_000_000 }, now);
    expect(await guard.allows(5_000)).toBe(true);
    expect(await guard.allows(20_000)).toBe(false);

    const monthly = new BudgetGuard(store, { monthlyTokens: 4_000_000, dailyTokens: 100_000_000 }, now);
    await store.addSearch({ day: '2026-10-01', tokens: 9_000, requests: 1, degraded: false });
    expect(await monthly.allows(5_000)).toBe(false);
  });

  it('records usage once per search and counts it immediately', async () => {
    const store = new MemoryUsageStore();
    const guard = new BudgetGuard(store, { monthlyTokens: 30_000, dailyTokens: 30_000 }, now);
    expect(await guard.allows(20_000)).toBe(true);
    await guard.recordSearch({ tokens: 20_000, requests: 3, degraded: false });
    expect(await guard.allows(20_000)).toBe(false); // cache updated without waiting 60 s
    expect(store.days.get('2026-10-03')).toEqual({ tokens: 20_000, requests: 3, searches: 1, degraded: 0 });
  });
});
