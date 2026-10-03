// Budget guard (spec 002 tech §5.5, FR-JEV-008, FR-JEV-009): caps are checked before sending; usage is written
// once per search. When a cap would be crossed the search runs in degraded mode instead of spending money.

export interface UsageStore {
  /** Input tokens used so far this UTC month / day. */
  totals(now: Date): Promise<{ month: number; day: number }>;
  addSearch(entry: { day: string; tokens: number; requests: number; degraded: boolean }): Promise<void>;
}

export interface BudgetCaps {
  monthlyTokens: number;
  dailyTokens: number;
}

export class BudgetGuard {
  private cache: { month: number; day: number; fetchedAt: number; dayKey: string } | null = null;

  constructor(
    private readonly store: UsageStore,
    private readonly caps: BudgetCaps,
    private readonly now: () => number = Date.now,
    private readonly cacheMs = 60_000,
  ) {}

  private async totals(): Promise<{ month: number; day: number }> {
    const t = this.now();
    const dayKey = new Date(t).toISOString().slice(0, 10);
    if (!this.cache || t - this.cache.fetchedAt > this.cacheMs || this.cache.dayKey !== dayKey) {
      const fresh = await this.store.totals(new Date(t));
      this.cache = { ...fresh, fetchedAt: t, dayKey };
    }
    return this.cache;
  }

  /** False when sending `estimate` more tokens would cross the daily or monthly cap. */
  async allows(estimate: number): Promise<boolean> {
    try {
      const { month, day } = await this.totals();
      return month + estimate <= this.caps.monthlyTokens && day + estimate <= this.caps.dailyTokens;
    } catch {
      // Usage store unreachable: keep serving with the last known totals, or allow if none (caps are monthly).
      if (!this.cache) return true;
      return this.cache.month + estimate <= this.caps.monthlyTokens;
    }
  }

  /** One write per search (spec 012 RPC `jev_usage_add`). */
  async recordSearch(usage: { tokens: number; requests: number; degraded: boolean }): Promise<void> {
    const day = new Date(this.now()).toISOString().slice(0, 10);
    if (this.cache && this.cache.dayKey === day) {
      this.cache.month += usage.tokens;
      this.cache.day += usage.tokens;
    }
    await this.store.addSearch({ day, ...usage });
  }
}

/** In-process store for mock mode and tests. */
export class MemoryUsageStore implements UsageStore {
  readonly days = new Map<string, { tokens: number; requests: number; searches: number; degraded: number }>();

  async totals(now: Date) {
    const day = now.toISOString().slice(0, 10);
    const month = day.slice(0, 7);
    let monthTotal = 0;
    for (const [d, v] of this.days) if (d.startsWith(month)) monthTotal += v.tokens;
    return { month: monthTotal, day: this.days.get(day)?.tokens ?? 0 };
  }

  async addSearch(entry: { day: string; tokens: number; requests: number; degraded: boolean }) {
    const cur = this.days.get(entry.day) ?? { tokens: 0, requests: 0, searches: 0, degraded: 0 };
    this.days.set(entry.day, {
      tokens: cur.tokens + entry.tokens,
      requests: cur.requests + entry.requests,
      searches: cur.searches + 1,
      degraded: cur.degraded + (entry.degraded ? 1 : 0),
    });
  }
}
