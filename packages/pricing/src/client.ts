// Browser-safe pricing helpers (spec 006 tech §4–5): sections, slider scale and money display. No data files here —
// the page receives prices with the results and the FX table with the search snapshot.
import { pricing } from '@domains-all/config/defaults';

/** Internal section codes; the UI labels sections only by price range (FR-PRC-003). */
export type Tier = 'free' | 'budget' | 'mid' | 'premium';

export interface FxTable {
  base: 'USD';
  asOf: string;
  /** Units of each currency per 1 USD; always contains USD = 1. */
  rates: Readonly<Record<string, number>>;
}

const { budget: BUDGET_MAX, mid: MID_MAX } = pricing.sectionUpperBoundsUsdCents;

/** Free = $0; $1–100 = $0.01–$100.00; $101–300 = $100.01–$300.00; $300+ above (tech §5.1). */
export function tierOf(upfrontUsdCents: number): Tier {
  if (upfrontUsdCents === 0) return 'free';
  if (upfrontUsdCents <= BUDGET_MAX) return 'budget';
  if (upfrontUsdCents <= MID_MAX) return 'mid';
  return 'premium';
}

/** The $300+ section shows only when it has results or a premium/resale source exists (FR-PRC-003). */
export function showPremiumSection(
  premiumCount: number,
  cfg: { premiumProviders: readonly string[]; aftermarketProviders: readonly string[] },
): boolean {
  return premiumCount > 0 || cfg.premiumProviders.length > 0 || cfg.aftermarketProviders.length > 0;
}

/** Section boundaries in USD cents: [min, max] inclusive, max null = no upper bound. */
export const TIER_BOUNDS: Record<Tier, readonly [number, number | null]> = {
  free: [0, 0],
  budget: [1, BUDGET_MAX],
  mid: [BUDGET_MAX + 1, MID_MAX],
  premium: [MID_MAX + 1, null],
};

const NO_DECIMALS = new Set(['JPY', 'KRW', 'IDR', 'HUF', 'ISK', 'CLP', 'VND', 'TWD', 'INR']);

/** Converts USD cents to the display currency (major units), or undefined when no rate exists. */
export function convertUsdCents(usdCents: number, currency: string, fx: FxTable): number | undefined {
  const rate = currency === 'USD' ? 1 : fx.rates[currency];
  return rate ? (usdCents / 100) * rate : undefined;
}

/** "$9.73", or "≈ ¥1,450" for converted amounts (FR-PRC-010: conversions are marked approximate). */
export function formatMoney(usdCents: number, currency: string, fx: FxTable, locale = 'en'): string {
  const value = convertUsdCents(usdCents, currency, fx);
  const cur = value === undefined ? 'USD' : currency;
  const amount = value ?? usdCents / 100;
  const whole = NO_DECIMALS.has(cur) || amount >= 1000;
  const text = new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: cur,
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: whole ? 0 : 2,
  }).format(whole ? Math.round(amount) : amount);
  return cur === 'USD' ? text : `≈ ${text}`;
}

/** Rounds to 2 significant figures for section labels ("≈ ¥150–15,000"). */
function twoSig(n: number): number {
  if (n === 0) return 0;
  const p = 10 ** (Math.floor(Math.log10(n)) - 1);
  return Math.round(n / p) * p;
}

/** Section label in the display currency; boundaries stay defined in USD (FR-PRC-010). */
export function sectionLabel(tier: Tier, currency: string, fx: FxTable, locale = 'en'): string {
  if (tier === 'free') return 'Free';
  const rate = currency === 'USD' ? 1 : fx.rates[currency];
  const cur = rate ? currency : 'USD';
  const r = rate ?? 1;
  const fmt = (usd: number) =>
    new Intl.NumberFormat(locale, { style: 'currency', currency: cur, maximumFractionDigits: 0 }).format(
      cur === 'USD' ? usd : twoSig(usd * r),
    );
  const label =
    tier === 'budget'
      ? `${fmt(1)}–${fmt(100).replace(/^\D+/, '')}`
      : tier === 'mid'
        ? `${fmt(101)}–${fmt(300).replace(/^\D+/, '')}`
        : `${fmt(300)}+`;
  return cur === 'USD' ? label : `≈ ${label}`;
}

// ---- price range slider (tech §5.4) ----

export const SLIDER_STEPS = 1000;

/** Snaps to friendly steps: < $10 → $1, < $100 → $5, < $1,000 → $25, < $5,000 → $100, else $250. */
export function round125(usd: number): number {
  const step = usd < 10 ? 1 : usd < 100 ? 5 : usd < 1000 ? 25 : usd < 5000 ? 100 : 250;
  return Math.max(1, Math.round(usd / step) * step);
}

/** Slider position (0–1000) → USD; 0 is free, 1000 is "$10,000+" (Infinity). Log scale for finer low steps. */
export function positionToUsd(position: number): number {
  if (position <= 0) return 0;
  if (position >= SLIDER_STEPS) return Number.POSITIVE_INFINITY;
  return round125(10 ** ((position / SLIDER_STEPS) * Math.log10(pricing.sliderMaxUsd)));
}

export function usdToPosition(usd: number): number {
  if (usd <= 0) return 0;
  if (!Number.isFinite(usd) || usd >= pricing.sliderMaxUsd) return SLIDER_STEPS;
  return Math.max(1, Math.min(SLIDER_STEPS - 1, Math.round((Math.log10(Math.max(1, usd)) / Math.log10(pricing.sliderMaxUsd)) * SLIDER_STEPS)));
}

/** Range filter on USD cents; max = Infinity means no upper bound. Free results count when min is 0 (FR-PRC-018). */
export function inRange(usdCents: number, minUsd: number, maxUsd: number): boolean {
  return usdCents >= Math.round(minUsd * 100) && (maxUsd === Number.POSITIVE_INFINITY || usdCents <= Math.round(maxUsd * 100));
}
