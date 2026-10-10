// Prices and FX rates written daily by the price job (spec 010 §5.1, tasks/M5-freshness.md decision 2). Both tables
// are public reference data (spec 012 §4), read here over the database's REST interface with the public key, so
// the site gets fresh prices even though Porkbun does not answer the hosting provider.
import { timedFetch } from '@domains-all/config/net';
import type { FxTable } from './client';
import { assertSanePrices, PORKBUN, type TldPrice } from './sources';

export interface PublicDatabase {
  url: string;
  anonKey: string;
}

const PAGE = 1000; // the REST interface returns at most 1,000 rows per request

async function rows<T>(db: PublicDatabase, path: string, fetchFn?: typeof fetch): Promise<T[]> {
  const res = await timedFetch(new URL(`/rest/v1/${path}`, db.url).toString(), {
    headers: { apikey: db.anonKey, authorization: `Bearer ${db.anonKey}`, accept: 'application/json' },
    timeoutMs: 5000,
    maxBytes: 2_000_000,
    fetchFn,
  });
  if (!res?.ok || res.text === undefined)
    throw new Error(`database ${path.split('?')[0]} → ${res?.status ?? 'no answer'}`);
  return JSON.parse(res.text) as T[];
}

/** The registrar's price list as of the last price job; throws when missing or not sane. */
export async function loadDatabasePrices(
  db: PublicDatabase,
  fetchFn?: typeof fetch,
): Promise<{ prices: Map<string, TldPrice>; pricesAt: string }> {
  const prices = new Map<string, TldPrice>();
  let latest = '';
  for (let offset = 0; offset < 20 * PAGE; offset += PAGE) {
    const page = await rows<{
      tld: string;
      register_cents: number | null;
      renew_cents: number | null;
      fetched_at: string;
    }>(
      db,
      `tld_prices?select=tld,register_cents,renew_cents,fetched_at&provider=eq.${PORKBUN.id}&order=tld.asc&limit=${PAGE}&offset=${offset}`,
      fetchFn,
    );
    for (const r of page) {
      if (r.register_cents === null || r.renew_cents === null) continue;
      prices.set(r.tld, { registerCents: r.register_cents, renewCents: r.renew_cents });
      if (r.fetched_at > latest) latest = r.fetched_at;
    }
    if (page.length < PAGE) break;
  }
  assertSanePrices(prices);
  return { prices, pricesAt: new Date(latest).toISOString() };
}

/** The latest day of currency rates in the database. */
export async function loadDatabaseFx(db: PublicDatabase, fetchFn?: typeof fetch): Promise<FxTable> {
  const list = await rows<{ quote: string; rate: number | string; as_of: string }>(
    db,
    'fx_rates?select=quote,rate,as_of&base=eq.USD&order=as_of.desc,quote.asc&limit=200',
    fetchFn,
  );
  const asOf = list[0]?.as_of;
  const rates: Record<string, number> = { USD: 1 };
  for (const r of list) if (r.as_of === asOf && Number(r.rate) > 0) rates[r.quote] = Number(r.rate);
  if (!asOf || Object.keys(rates).length < 10) throw new Error('database FX rates missing');
  return { base: 'USD', asOf, rates };
}
