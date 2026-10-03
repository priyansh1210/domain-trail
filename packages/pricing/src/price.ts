// Upfront and renewal price for one name (spec 006 tech §5.2; FR-PRC-001, 002, 012, 014, 015, 016). Never invents
// a price: an extension without a sourced price is "unpriced" and goes to the "Price at registrar" list.
import { pricing } from '@domains-all/config/defaults';
import type { PriceBook } from './book';
import { type Tier, tierOf } from './client';

export interface PriceInput {
  label: string;
  tld: string;
  /** Availability status (spec 005). */
  status: string;
  /** Registry premium price, when a premium check found one. */
  premium?: { registerCents: number; renewCents?: number };
  /** The label is a common word (premium prices are likely for short or dictionary names). */
  commonWord?: boolean;
}

export interface Restriction {
  kind: 'local_presence' | 'eligibility' | 'blocked_for_public';
  note: string;
}

export interface PricedResult {
  priced: true;
  /** What you pay today: first year plus the rest of a multi-year minimum (FR-PRC-002). */
  upfrontUsdCents: number;
  firstYearUsdCents: number;
  renewUsdCents: number;
  minYears: number;
  tier: Tier;
  source: string;
  buyUrl: string;
  premium: boolean;
  premiumPossible: boolean;
  renewWarning: boolean;
  requiresHttps: boolean;
  restriction?: Restriction;
}

export interface Unpriced {
  priced: false;
  requiresHttps: boolean;
  restriction?: Restriction;
}

/** Short or dictionary labels on registries with premium tiers may cost more than the list price (FR-PRC-012). */
const PREMIUM_LIKELY_MAX_LENGTH = 5;

export function priceFor(input: PriceInput, book: PriceBook): PricedResult | Unpriced {
  const policy = book.policyFor(input.tld);
  const restriction: Restriction | undefined =
    policy.restriction !== 'none' && policy.note ? { kind: policy.restriction, note: policy.note } : undefined;
  const base = { requiresHttps: policy.requiresHttps, ...(restriction ? { restriction } : {}) };
  const list = book.prices.get(input.tld);
  if (!list && !input.premium) return { priced: false, ...base };

  const first = input.premium?.registerCents ?? list!.registerCents;
  const renew = input.premium?.renewCents ?? list?.renewCents ?? first;
  const upfront = first + (policy.minYears - 1) * renew;
  const registrable = ['available', 'likely_available', 'available_premium'].includes(input.status);
  return {
    priced: true,
    upfrontUsdCents: upfront,
    firstYearUsdCents: first,
    renewUsdCents: renew,
    minYears: policy.minYears,
    tier: tierOf(upfront),
    source: book.provider.name,
    buyUrl: book.provider.buyUrl(`${input.label}.${input.tld}`),
    premium: !!input.premium || input.status === 'available_premium',
    premiumPossible:
      registrable &&
      !input.premium &&
      input.status !== 'available_premium' &&
      policy.premiumNames &&
      (input.label.length <= PREMIUM_LIKELY_MAX_LENGTH || !!input.commonWord),
    renewWarning: renew > pricing.renewalWarningRatio * first,
    ...base,
  };
}

/** Extensions whose upfront price falls in the band (±10 % neighbours) for "Find more in this range" (FR-PRC-009). */
export function tldsInBand(minCents: number, maxCents: number | null, pool: readonly string[], book: PriceBook): string[] {
  const lo = minCents * 0.9;
  const hi = maxCents === null ? Number.POSITIVE_INFINITY : maxCents * 1.1;
  return pool.filter((tld) => {
    const p = book.prices.get(tld);
    if (!p) return false;
    const upfront = p.registerCents + (book.policyFor(tld).minYears - 1) * p.renewCents;
    return upfront >= lo && upfront <= hi;
  });
}
