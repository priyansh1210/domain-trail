// Price and FX sources (spec 006 tech §5.3, §5.6; research R-04, R-09). Porkbun's public price list needs no key;
// Frankfurter serves ECB reference rates. Both are sanity-checked; a failed check keeps the previous data.
import type { FxTable } from './client';

export const PORKBUN_PRICING_URL = 'https://api.porkbun.com/api/json/v3/pricing/get';
export const FRANKFURTER_URL = 'https://api.frankfurter.dev/v1/latest?base=USD';

export interface TldPrice {
  registerCents: number;
  renewCents: number;
}

export interface PriceProvider {
  id: string;
  /** Shown as "Price from …" (FR-PRC-001). */
  name: string;
  /** Registrar page for the exact name, without tracking parameters (FR-PRC-017). */
  buyUrl(fqdn: string): string;
}

export const PORKBUN: PriceProvider = {
  id: 'porkbun',
  name: 'Porkbun',
  buyUrl: (fqdn) => `https://porkbun.com/checkout/search?q=${encodeURIComponent(fqdn)}`,
};

const toCents = (usd: unknown) => {
  const n = Math.round(Number(usd) * 100);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
};

/** Parses Porkbun's `{ status, pricing: { tld: { registration, renewal } } }` and checks it looks sane. */
export function parsePorkbun(json: unknown): Map<string, TldPrice> {
  const data = json as {
    status?: unknown;
    pricing?: Record<string, { registration?: unknown; renewal?: unknown }>;
  };
  if (data.status !== 'SUCCESS' || !data.pricing) throw new Error('Porkbun pricing: unexpected answer');
  const out = new Map<string, TldPrice>();
  for (const [tld, p] of Object.entries(data.pricing)) {
    const registerCents = toCents(p.registration);
    const renewCents = toCents(p.renewal);
    if (registerCents !== undefined && renewCents !== undefined)
      out.set(tld.toLowerCase(), { registerCents, renewCents });
  }
  assertSanePrices(out);
  return out;
}

/** Tech §5.6: at least 300 TLDs, .com between $5 and $30. */
export function assertSanePrices(prices: ReadonlyMap<string, TldPrice>): void {
  const com = prices.get('com');
  if (prices.size < 300 || !com || com.registerCents < 500 || com.registerCents > 3000)
    throw new Error('price list failed the sanity check');
}

/** Parses Frankfurter's `{ base, date, rates }`. */
export function parseFrankfurter(json: unknown): FxTable {
  const data = json as { base?: unknown; date?: unknown; rates?: Record<string, unknown> };
  if (data.base !== 'USD' || !data.rates || typeof data.date !== 'string')
    throw new Error('FX: unexpected answer');
  const rates: Record<string, number> = { USD: 1 };
  for (const [cur, r] of Object.entries(data.rates)) if (typeof r === 'number' && r > 0) rates[cur] = r;
  if (Object.keys(rates).length < 10) throw new Error('FX: too few currencies');
  return { base: 'USD', asOf: data.date, rates };
}
