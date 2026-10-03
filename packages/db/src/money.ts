// Money and time helpers (spec 012 FR-DATA-006, spec 000 tech §6): integer cents + ISO 4217 code, never
// floats; timestamps always UTC.

export interface Money {
  cents: number;
  currency: string;
}

const CURRENCY = /^[A-Z]{3}$/;

export function money(cents: number, currency: string): Money {
  if (!Number.isSafeInteger(cents) || cents < 0)
    throw new RangeError(`cents must be a non-negative integer: ${cents}`);
  if (!CURRENCY.test(currency)) throw new RangeError(`currency must be an ISO 4217 code: ${currency}`);
  return { cents, currency };
}

/** Parses a decimal price string from a provider ("9.73", "1,234.50") into cents without float drift. */
export function parseCents(decimal: string): number {
  const clean = decimal.trim().replace(/,/g, '');
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(clean);
  if (!match) throw new RangeError(`not a price: ${decimal}`);
  const [, whole = '0', fraction = ''] = match;
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
}

/** Converts using a rate (quote per base), rounding half-up to whole cents. */
export function convertCents(cents: number, rate: number): number {
  if (!(rate > 0)) throw new RangeError(`rate must be positive: ${rate}`);
  return Math.round(cents * rate);
}

/**
 * Display only; converted amounts are marked approximate by the caller (spec 006 FR-PRC-010). Cents are
 * always hundredths of the unit, and Intl rounds to the currency's own digits (e.g. none for JPY).
 */
export function formatMoney(m: Money, locale = 'en-US'): string {
  return new Intl.NumberFormat(locale, { style: 'currency', currency: m.currency }).format(m.cents / 100);
}

/** Current time as an ISO 8601 UTC string, the only format we store or send. */
export function utcNow(now: Date = new Date()): string {
  return now.toISOString();
}
