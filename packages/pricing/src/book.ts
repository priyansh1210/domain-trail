// The price book: prices per extension, FX rates and extension policies, kept in memory (spec 006 tech §10;
// tasks/M4-verify.md decision 3). Live mode refreshes Porkbun and Frankfurter in the background every 12 hours;
// the committed snapshots answer at once and remain the fallback.
import { pricing } from '@domains-all/config/defaults';
import { timedFetch, within } from '@domains-all/config/net';
import fxSnapshot from '../data/fx-rates.json';
import priceSnapshot from '../data/porkbun-prices.json';
import policyData from '../data/tld-policies.json';
import type { FxTable } from './client';
import { loadDatabaseFx, loadDatabasePrices, type PublicDatabase } from './database';
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

/** Every reviewed extension policy and the review date (seed for the `tld_policies` table, spec 010 job). */
export function policySeed(): { reviewedAt: string; policies: Readonly<Record<string, TldPolicy>> } {
  return { reviewedAt: policyData.reviewedAt, policies: POLICIES };
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

export type PriceDataSource = 'database' | 'porkbun' | 'snapshot';

export function createPriceSource(opts: {
  live: boolean;
  fetchFn?: typeof fetch;
  now?: () => number;
  /** Daily price job tables (M5). Without it the server asks Porkbun and Frankfurter itself. */
  database?: PublicDatabase;
}) {
  const now = opts.now ?? Date.now;
  let book = snapshotBook();
  let source: PriceDataSource = 'snapshot';
  let tried = opts.live ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY; // live: never tried yet
  let inFlight: Promise<void> | undefined;
  const maxAge = opts.database ? pricing.databaseRefreshMinutes * 60_000 : pricing.refreshHours * 3600_000;
  const RETRY_AFTER_FAILURE_MS = 10 * 60_000;
  const youngerThan = (iso: string, hours: number) => now() - Date.parse(iso) < hours * 3600_000;
  const message = (e: unknown) => String((e as Error)?.message ?? e);

  async function load(): Promise<void> {
    const get = async (url: string) => {
      const res = await timedFetch(url, { timeoutMs: 10_000, maxBytes: 2_000_000, fetchFn: opts.fetchFn });
      if (!res?.ok || !res.text) throw new Error(`${url} → ${res?.status ?? 'no answer'}`);
      return JSON.parse(res.text) as unknown;
    };
    const errors: { pricesError?: string; fxError?: string } = {};
    const [dbPrices, dbFx] = opts.database
      ? await Promise.allSettled([
          loadDatabasePrices(opts.database, opts.fetchFn),
          loadDatabaseFx(opts.database, opts.fetchFn),
        ])
      : [undefined, undefined];
    const fromDb = dbPrices?.status === 'fulfilled' ? dbPrices.value : undefined;
    const fxDb = dbFx?.status === 'fulfilled' ? dbFx.value : undefined;

    // Ask the registrar and the rate service directly only when the database copy is missing or old.
    const needPrices = !fromDb || !youngerThan(fromDb.pricesAt, pricing.databaseFreshHours);
    const needFx = !fxDb || !youngerThan(`${fxDb.asOf}T00:00:00Z`, 4 * 24); // no ECB rates at weekends
    const [direct, fxDirect] = await Promise.allSettled([
      needPrices ? get(PORKBUN_PRICING_URL).then(parsePorkbun) : Promise.resolve(undefined),
      needFx ? get(FRANKFURTER_URL).then(parseFrankfurter) : Promise.resolve(undefined),
    ]);

    const candidates: Array<{
      prices: ReadonlyMap<string, TldPrice>;
      pricesAt: string;
      from: PriceDataSource;
    }> = [];
    if (fromDb) candidates.push({ ...fromDb, from: 'database' });
    if (direct.status === 'fulfilled' && direct.value)
      candidates.push({ prices: direct.value, pricesAt: new Date(now()).toISOString(), from: 'porkbun' });
    const best = candidates.sort((a, b) => Date.parse(b.pricesAt) - Date.parse(a.pricesAt))[0];
    if (best && Date.parse(best.pricesAt) >= Date.parse(book.pricesAt)) {
      book = { ...book, prices: best.prices, pricesAt: best.pricesAt };
      source = best.from;
    }
    const fx = [fxDb, fxDirect.status === 'fulfilled' ? fxDirect.value : undefined]
      .filter((f): f is FxTable => !!f)
      .sort((a, b) => (a.asOf < b.asOf ? 1 : -1))[0];
    if (fx && fx.asOf >= book.fx.asOf) book = { ...book, fx };

    if (!best)
      errors.pricesError = [
        dbPrices?.status === 'rejected' ? `database: ${message(dbPrices.reason)}` : '',
        direct.status === 'rejected' ? message(direct.reason) : '',
      ]
        .filter(Boolean)
        .join('; ');
    if (!fx)
      errors.fxError = [
        dbFx?.status === 'rejected' ? `database: ${message(dbFx.reason)}` : '',
        fxDirect.status === 'rejected' ? message(fxDirect.reason) : '',
      ]
        .filter(Boolean)
        .join('; ');
    refresh = {
      at: new Date(now()).toISOString(),
      ok: !!best && !!fx,
      ...(errors.pricesError ? { pricesError: errors.pricesError } : {}),
      ...(errors.fxError ? { fxError: errors.fxError } : {}),
    };
  }

  /** Last refresh attempt, for the health check and logs (FR-PRC-011). */
  let refresh: { at: string; ok: boolean; pricesError?: string; fxError?: string } | undefined;

  /** Starts a refresh when one is due. After a failure the next try comes 10 minutes later, not 12 hours. */
  function start(): void {
    if (inFlight || now() - tried < maxAge) return;
    tried = now();
    inFlight = load()
      .catch(() => undefined)
      .finally(() => {
        inFlight = undefined;
        if (!refresh?.ok) tried = now() - maxAge + RETRY_AFTER_FAILURE_MS;
      });
  }

  return {
    get(): PriceBook {
      start();
      return book;
    },
    /**
     * Refreshes within the current request when due, waiting at most `maxWaitMs`. Serverless hosts freeze work that
     * outlives a response (2026-10-04: background refreshes on the production host never finished).
     */
    async ensureFresh(maxWaitMs: number): Promise<PriceBook> {
      start();
      if (inFlight) await within(inFlight, maxWaitMs, undefined);
      return book;
    },
    settled: () => inFlight ?? Promise.resolve(),
    /** When prices and FX rates were fetched, and how the last refresh went. */
    status() {
      return { pricesAt: book.pricesAt, fxAsOf: book.fx.asOf, live: opts.live, source, lastRefresh: refresh };
    },
  };
}

export type PriceSource = ReturnType<typeof createPriceSource>;
