'use client';
// Filter bar (spec 006 FR-PRC-004…008, 010; spec 009 FR-UX-018): two-handle price range from $0 to "$10,000+",
// typed minimum/maximum in the display currency, quick ranges per section, price basis, currency and sort.
import {
  type FxTable,
  formatMoney,
  positionToUsd,
  SLIDER_STEPS,
  sectionLabel,
  TIER_BOUNDS,
  type Tier,
  usdToPosition,
} from '@domains-all/pricing/client';
import { useEffect, useState } from 'react';
import type { Basis, Filters, Sort } from '@/lib/client/results';
import { t } from '@/lib/i18n';

const INF = Number.POSITIVE_INFINITY;

export function PriceFilter({
  filters,
  onChange,
  currency,
  onCurrency,
  fx,
  showPremium,
}: {
  filters: Filters;
  onChange: (f: Filters) => void;
  currency: string;
  onCurrency: (c: string) => void;
  fx: FxTable;
  showPremium: boolean;
}) {
  const rate = fx.rates[currency] ?? 1;
  const usd = (v: number) => formatMoney(Math.round(v * 100), currency, fx);
  const valueText = (v: number) => (v === INF ? t('results.noMax') : usd(v));
  const toDisplay = (v: number) => (v === INF ? '' : String(Math.round(v * rate * 100) / 100));
  const [minText, setMinText] = useState(toDisplay(filters.min));
  const [maxText, setMaxText] = useState(toDisplay(filters.max));
  useEffect(() => {
    setMinText(toDisplay(filters.min));
    setMaxText(toDisplay(filters.max));
    // re-sync the typed boxes when the range or currency changes
  }, [filters.min, filters.max, currency, rate]);

  const set = (patch: Partial<Filters>) => {
    let { min, max } = { ...filters, ...patch };
    if (min > max) [min, max] = [max, min];
    onChange({ ...filters, ...patch, min, max });
  };

  const commitTyped = () => {
    const parse = (s: string, fallback: number) => {
      if (s.trim() === '') return fallback;
      const n = Number(s.replace(/[^\d.]/g, ''));
      return Number.isFinite(n) && n >= 0 ? n / rate : fallback;
    };
    set({ min: parse(minText, 0), max: parse(maxText, INF) });
  };

  const presets: Array<{ id: string; label: string; min: number; max: number }> = [
    { id: 'all', label: t('results.presetAll'), min: 0, max: INF },
    ...(['free', 'budget', 'mid', 'premium'] as Tier[])
      .filter((tier) => tier !== 'premium' || showPremium)
      .map((tier) => {
        const [lo, hi] = TIER_BOUNDS[tier];
        return {
          id: tier,
          label: sectionLabel(tier, currency, fx),
          min: lo / 100,
          max: hi === null ? INF : hi / 100,
        };
      }),
  ];

  return (
    <section
      aria-labelledby="filter-title"
      className="card flex flex-col gap-4 p-4 sm:p-5"
      data-testid="price-filter"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="filter-title" className="text-base">
          {t('results.filterTitle')}
        </h2>
        <span className="wordmark text-[0.95rem] tabular-nums" aria-hidden="true">
          {valueText(filters.min)} – {filters.max === INF ? `${usd(10_000)}+` : valueText(filters.max)}
        </span>
      </div>
      <div
        className="range-dual"
        style={
          {
            '--lo': `${(usdToPosition(filters.min) / SLIDER_STEPS) * 100}%`,
            '--hi': `${(usdToPosition(filters.max) / SLIDER_STEPS) * 100}%`,
          } as React.CSSProperties
        }
      >
        <input
          type="range"
          min={0}
          max={SLIDER_STEPS}
          step={1}
          value={usdToPosition(filters.min)}
          aria-label={t('results.minPrice')}
          aria-valuetext={t('results.minValue', { price: valueText(filters.min) })}
          onChange={(e) =>
            set({
              min: Math.min(positionToUsd(Number(e.target.value)), filters.max === INF ? INF : filters.max),
            })
          }
        />
        <input
          type="range"
          min={0}
          max={SLIDER_STEPS}
          step={1}
          value={usdToPosition(filters.max)}
          aria-label={t('results.maxPrice')}
          aria-valuetext={t('results.maxValue', { price: valueText(filters.max) })}
          onChange={(e) => set({ max: Math.max(positionToUsd(Number(e.target.value)), filters.min) })}
        />
      </div>
      <div className="flex flex-wrap items-end gap-3 text-sm">
        <label className="flex flex-col gap-1 font-medium">
          {t('results.minPrice')} ({currency})
          <input
            inputMode="decimal"
            value={minText}
            onChange={(e) => setMinText(e.target.value)}
            onBlur={commitTyped}
            onKeyDown={(e) => e.key === 'Enter' && commitTyped()}
            className="field w-32 py-1.5 font-normal"
          />
        </label>
        <label className="flex flex-col gap-1 font-medium">
          {t('results.maxPrice')} ({currency})
          <input
            inputMode="decimal"
            value={maxText}
            placeholder={t('results.noMax')}
            onChange={(e) => setMaxText(e.target.value)}
            onBlur={commitTyped}
            onKeyDown={(e) => e.key === 'Enter' && commitTyped()}
            className="field w-32 py-1.5 font-normal"
          />
        </label>
      </div>

      <div role="group" aria-label={t('results.presets')} className="flex flex-wrap gap-2 text-sm">
        {presets.map((p) => {
          const active = filters.min === p.min && filters.max === p.max;
          return (
            <button
              key={p.id}
              type="button"
              aria-pressed={active}
              onClick={() => set({ min: p.min, max: p.max })}
              className="chip-toggle"
            >
              {p.label}
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-3 border-t border-[var(--border)] pt-4 text-sm">
        <fieldset className="flex items-center gap-3">
          <legend className="sr-only">{t('results.basis')}</legend>
          <span aria-hidden="true">{t('results.basis')}:</span>
          {(['upfront', 'renewal'] as Basis[]).map((b) => (
            <label key={b} className="flex items-center gap-1">
              <input
                type="radio"
                className="accent-[var(--accent)]"
                name="basis"
                checked={filters.basis === b}
                onChange={() => set({ basis: b })}
              />
              {t(b === 'upfront' ? 'results.basisUpfront' : 'results.basisRenewal')}
            </label>
          ))}
        </fieldset>
        <label className="flex items-center gap-2">
          {t('results.currency')}
          <select
            value={currency}
            onChange={(e) => onCurrency(e.target.value)}
            className="field w-auto py-1.5"
          >
            {Object.keys(fx.rates)
              .sort()
              .map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
          </select>
        </label>
        <label className="flex items-center gap-2">
          {t('results.sort')}
          <select
            value={filters.sort}
            onChange={(e) => set({ sort: e.target.value as Sort })}
            className="field w-auto py-1.5"
          >
            <option value="best">{t('results.sortBest')}</option>
            <option value="price">{t('results.sortPrice')}</option>
            <option value="short">{t('results.sortShort')}</option>
          </select>
        </label>
        <label className="flex items-center gap-1">
          <input
            type="checkbox"
            className="accent-[var(--accent)]"
            checked={filters.includeFree}
            onChange={(e) => set({ includeFree: e.target.checked })}
          />
          {t('results.includeFree')}
        </label>
      </div>
      {currency !== 'USD' && <p className="text-xs text-[var(--muted)]">{t('results.approx')}</p>}
    </section>
  );
}
