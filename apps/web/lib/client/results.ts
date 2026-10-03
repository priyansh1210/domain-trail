// Results page logic without React (spec 006 tech §5.4, spec 009 tech §5): price filter, sorting, order per section,
// default currency and "checked 3 min ago". Kept pure so it is unit-tested and fast (NFR-PRC-001).
import type { ResultItem, Section } from '@domains-all/core/client';
import { inRange } from '@domains-all/pricing/client';

export type Basis = 'upfront' | 'renewal';
export type Sort = 'best' | 'price' | 'short';

export interface Filters {
  /** USD; max Infinity = "$10,000+". */
  min: number;
  max: number;
  basis: Basis;
  sort: Sort;
  includeFree: boolean;
}

export const DEFAULT_FILTERS: Filters = {
  min: 0,
  max: Number.POSITIVE_INFINITY,
  basis: 'upfront',
  sort: 'best',
  includeFree: true,
};

const MAX_PER_LABEL = 3;

function priceCents(r: ResultItem, basis: Basis): number | undefined {
  if (r.section === 'free') return 0;
  if (!r.price) return undefined;
  return basis === 'upfront' ? r.price.upfrontUsdCents : r.price.renewUsdCents;
}

/** Does the result pass the range? "Price at registrar" results are never filtered out (FR-PRC-016). */
export function passes(r: ResultItem, f: Filters): boolean {
  if (r.section === 'unpriced') return true;
  if (r.section === 'free') return f.includeFree && f.min === 0; // FR-PRC-018
  const cents = priceCents(r, f.basis);
  return cents !== undefined && inRange(cents, f.min, f.max);
}

/**
 * Visible results of one section in display order. Uses the server's final order when known (variety rules,
 * spec 008 §5.5); while streaming, best score first with at most 3 extensions per name.
 */
export function sectionItems(
  section: Section,
  results: Readonly<Record<string, ResultItem>>,
  order: readonly string[] | undefined,
  f: Filters,
): ResultItem[] {
  let items: ResultItem[];
  if (order) {
    items = order.map((fqdn) => results[fqdn]).filter((r): r is ResultItem => !!r);
    // results that arrived after the final order (re-check updates keep their place)
    const listed = new Set(order);
    items.push(
      ...Object.values(results)
        .filter((r) => r.section === section && !listed.has(r.fqdn))
        .sort((a, b) => b.score - a.score),
    );
  } else {
    const perLabel = new Map<string, number>();
    items = Object.values(results)
      .filter((r) => r.section === section)
      .sort((a, b) => b.score - a.score || a.fqdn.localeCompare(b.fqdn))
      .filter((r) => {
        const n = perLabel.get(r.label) ?? 0;
        perLabel.set(r.label, n + 1);
        return n < MAX_PER_LABEL;
      });
  }
  items = items.filter((r) => passes(r, f));
  if (f.sort === 'price')
    items.sort(
      (a, b) =>
        (priceCents(a, f.basis) ?? Infinity) - (priceCents(b, f.basis) ?? Infinity) || b.score - a.score,
    );
  if (f.sort === 'short') items.sort((a, b) => a.fqdn.length - b.fqdn.length || b.score - a.score);
  return items;
}

// ---- display currency (FR-PRC-010) ----

const REGION_CURRENCY: Record<string, string> = {
  US: 'USD',
  IN: 'INR',
  JP: 'JPY',
  GB: 'GBP',
  CN: 'CNY',
  CA: 'CAD',
  AU: 'AUD',
  CH: 'CHF',
  SG: 'SGD',
  NZ: 'NZD',
  KR: 'KRW',
  BR: 'BRL',
  MX: 'MXN',
  ZA: 'ZAR',
  SE: 'SEK',
  NO: 'NOK',
  DK: 'DKK',
  PL: 'PLN',
  CZ: 'CZK',
  HU: 'HUF',
  TR: 'TRY',
  ID: 'IDR',
  MY: 'MYR',
  PH: 'PHP',
  TH: 'THB',
  HK: 'HKD',
  IL: 'ILS',
  IS: 'ISK',
  RO: 'RON',
  DE: 'EUR',
  FR: 'EUR',
  IT: 'EUR',
  ES: 'EUR',
  NL: 'EUR',
  BE: 'EUR',
  AT: 'EUR',
  IE: 'EUR',
  PT: 'EUR',
  FI: 'EUR',
  GR: 'EUR',
  SK: 'EUR',
  SI: 'EUR',
  LU: 'EUR',
  LV: 'EUR',
  LT: 'EUR',
  EE: 'EUR',
  MT: 'EUR',
  CY: 'EUR',
  HR: 'EUR',
};

/** Currency of the browser's region when we have a rate for it, else USD. */
export function defaultCurrency(
  languages: readonly string[],
  supported: Readonly<Record<string, number>>,
): string {
  for (const lang of languages) {
    const region = lang.split('-')[1]?.toUpperCase();
    const cur = region ? REGION_CURRENCY[region] : undefined;
    if (cur && supported[cur]) return cur;
  }
  return 'USD';
}

/** "just now", "3 min ago", "2 h ago", "4 days ago" (FR-AVL-004). */
export function ago(
  iso: string,
  now = Date.now(),
): { key: 'justNow' | 'minutes' | 'hours' | 'days'; n: number } {
  const s = Math.max(0, (now - Date.parse(iso)) / 1000);
  if (s < 60) return { key: 'justNow', n: 0 };
  if (s < 3600) return { key: 'minutes', n: Math.floor(s / 60) };
  if (s < 86_400) return { key: 'hours', n: Math.floor(s / 3600) };
  return { key: 'days', n: Math.floor(s / 86_400) };
}

/** Parses `?min=10&max=50&basis=renewal&sort=price&cur=JPY&tab=mid` (FR-PRC-007). Min/max are USD. */
export function filtersFromParams(p: URLSearchParams): Filters & { cur?: string; tab?: Section } {
  const num = (v: string | null, fallback: number) => {
    if (v === null || v === '') return fallback;
    if (v === 'max') return Number.POSITIVE_INFINITY;
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? n : fallback;
  };
  let min = num(p.get('min'), 0);
  let max = num(p.get('max'), Number.POSITIVE_INFINITY);
  if (min > max) [min, max] = [max, min]; // typed backwards → swapped (spec 006 edge case)
  const basis = p.get('basis') === 'renewal' ? 'renewal' : 'upfront';
  const sort = (['price', 'short'] as const).find((s) => s === p.get('sort')) ?? 'best';
  const cur = p.get('cur')?.toUpperCase();
  const tab = (['free', 'budget', 'mid', 'premium', 'unpriced'] as const).find((t) => t === p.get('tab'));
  return {
    min,
    max,
    basis,
    sort,
    includeFree: p.get('free') !== '0',
    ...(cur ? { cur } : {}),
    ...(tab ? { tab } : {}),
  };
}

export function paramsFromFilters(f: Filters & { cur?: string; tab?: Section }): string {
  const p = new URLSearchParams();
  if (f.min > 0) p.set('min', String(f.min));
  if (f.max !== Number.POSITIVE_INFINITY) p.set('max', String(f.max));
  if (f.basis !== 'upfront') p.set('basis', f.basis);
  if (f.sort !== 'best') p.set('sort', f.sort);
  if (!f.includeFree) p.set('free', '0');
  if (f.cur && f.cur !== 'USD') p.set('cur', f.cur);
  if (f.tab) p.set('tab', f.tab);
  return p.toString();
}
