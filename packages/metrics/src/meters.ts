// Meters and budget thresholds (spec 015 tech §5.1, FR-OBS-003, 004): alerts at 50 / 80 / 100 % of each limit, and
// for monthly meters also when the month-end projection passes the limit before 80 % is reached.
import { observability } from '@domains-all/config/defaults';
import type { Alert, AlertLevel } from './alert';

export interface Meter {
  /** Short id used in alert keys: `db`, `jev-tokens`, `eval-tokens`, `email-day`, `email-month`. */
  resource: string;
  used: number;
  limit: number;
  period: 'day' | 'month' | 'now';
  unit?: string;
}

/** Highest threshold (0.5, 0.8, 1) that `used` has reached, or undefined below the first. */
export function crossedThreshold(
  used: number,
  limit: number,
  thresholds: readonly number[] = observability.alertThresholds,
): number | undefined {
  if (!(limit > 0)) return undefined;
  return [...thresholds].sort((a, b) => b - a).find((t) => used >= t * limit);
}

/** Month-end projection: used / day of month × days in month (UTC). */
export function monthProjection(used: number, now: Date): number {
  const day = now.getUTCDate();
  const days = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
  return (used / day) * days;
}

const levelOf = (t: number): AlertLevel => (t >= 1 ? 'critical' : t >= 0.8 ? 'warning' : 'info');

export function meterAlerts(meters: readonly Meter[], now: Date): Alert[] {
  const out: Alert[] = [];
  for (const m of meters) {
    const pct = m.limit > 0 ? Math.round((m.used / m.limit) * 100) : 0;
    const data = {
      used: Math.round(m.used),
      limit: m.limit,
      percent: pct,
      ...(m.unit ? { unit: m.unit } : {}),
    };
    const t = crossedThreshold(m.used, m.limit);
    if (t !== undefined) {
      out.push({
        level: levelOf(t),
        key: `budget-${m.resource}-${Math.round(t * 100)}`,
        message: `${m.resource} is at ${pct}% of its ${m.period === 'now' ? '' : `${m.period} `}limit`,
        data,
      });
    }
    if (m.period === 'month' && (t === undefined || t < 0.8)) {
      const projected = monthProjection(m.used, now);
      if (projected > m.limit)
        out.push({
          level: 'warning',
          key: `budget-${m.resource}-projected`,
          message: `${m.resource} is on course to pass its monthly limit`,
          data: { ...data, projected: Math.round(projected) },
        });
    }
  }
  return out;
}
