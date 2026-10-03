// The price book: prices per extension, FX rates and extension policies, kept in memory (spec 006 tech §10;
// tasks/M4-verify.md decision 3). Live mode refreshes Porkbun and Frankfurter in the background every 12 hours;
// the committed snapshots answer at once and remain the fallback.
import { pricing } from '@domains-all/config/defaults';
import fxSnapshot from '../data/fx-rates.json';
import priceSnapshot from '../data/porkbun-prices.json';
import policyData from '../data/tld-policies.json';
import type { FxTable } from './client';
import {
  FRANKFURTER_URL,
  parseFrankfurter,
  parsePorkbun,
  PORKBUN,
  PORKBUN_PRICING_URL,
  type PriceProvider,
  type TldPrice,
} from './sources';

export interface TldPolicy {
  restriction: 'none' | 'local_presence' | 'eligibility' | 'blocked_for_public';
  note?: string;
  minYears: number;
  requiresHttps: boolean;
  premiumNames: boolean;
}

const DEFAULT_POLICY: TldPolicy = {
  restriction: 'none',
  minYears: 1,
  requiresHttps: false,
  premiumNames: true,
};
const POLICIES = policyData.policies as Record<string, TldPolicy>;

export function policyFor(tld: string): TldPolicy {
  return POLICIES[tld] ?? DEFAULT_POLICY;
}

export interface PriceBook {
  provider: PriceProvider;
  prices: ReadonlyMap<string, TldPrice>;
  fx: FxTable;
  /** When the price list was fetched (ISO). */
  pricesAt: string;
  policyFor(tld: string): TldPolicy;
}

export function snapshotBook(): PriceBook {
  const prices = new Map<string, TldPrice>();
  for (const [tld, [registerCents, renewCents]] of Object.entries(
    priceSnapshot.prices as unknown as Record<string, [number, number]>,
  ))
    prices.set(tld, { registerCents, renewCents });
  return {
    provider: PORKBUN,
    prices,
    fx: { base: 'USD', asOf: fxSnapshot.asOf, rates: fxSnapshot.rates },
    pricesAt: priceSnapshot.fetchedAt,
    policyFor,
  };
}

/** Hours since the price list was fetched; a warning shows beyond `priceStaleHours` (NFR-PRC-002). */
export function priceAgeHours(book: PriceBook, now = Date.now()): number {
  return (now - Date.parse(book.pricesAt)) / 3600_000;
}

export function isStale(book: PriceBook, now = Date.now()): boolean {
  return priceAgeHours(book, now) > pricing.priceStaleHours;
}

export function createPriceSource(opts: { live: boolean; fetchFn?: typeof fetch; now?: () => number }) {
  const now = opts.now ?? Date.now;
  let book = snapshotBook();
  let tried = opts.live ? 0 : Number.POSITIVE_INFINITY;
  let inFlight: Promise<void> | undefined;
  const maxAge = pricing.refreshHours * 3600_000;

  async function load(): Promise<void> {
    const get = async (url: string) => {
      const res = await (opts.fetchFn ?? fetch)(url, { signal: AbortSignal.timeout(10_000) });
      if (!res.ok) throw new Error(`${url} → ${res.status}`);
      return res.json();
    };
    const [prices, fx] = await Promise.allSettled([
      get(PORKBUN_PRICING_URL).then(parsePorkbun),
      get(FRANKFURTER_URL).then(parseFrankfurter),
    ]);
    book = {
      ...book,
      ...(prices.status === 'fulfilled'
        ? { prices: prices.value, pricesAt: new Date(now()).toISOString() }
        : {}),
      ...(fx.status === 'fulfilled' ? { fx: fx.value } : {}),
    };
  }

  return {
    get(): PriceBook {
      if (!inFlight && now() - tried >= maxAge) {
        tried = now();
        inFlight = load()
          .catch(() => undefined)
          .finally(() => {
            inFlight = undefined;
          });
      }
      return book;
    },
    settled: () => inFlight ?? Promise.resolve(),
  };
}

export type PriceSource = ReturnType<typeof createPriceSource>;
