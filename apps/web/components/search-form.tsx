'use client';
// Home page form (spec 001 US-1…US-4, FR-INT-001…005, 011, 014). Validation uses the same schema as the server.
import { intake } from '@domains-all/config/defaults';
import { normalize } from '@domains-all/core/client/normalize';
import type { Example, Preferences } from '@domains-all/core/client';
import {
  type FxTable,
  formatMoney,
  positionToUsd,
  SLIDER_STEPS,
  usdToPosition,
} from '@domains-all/pricing/client';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { defaultCurrency } from '@/lib/client/results';
import type { StartError } from '@/lib/client/search';
import { format } from '@/lib/format';
import { HumanCheck, type HumanCheckHandle } from './human-check';
import { TldInput } from './tld-input';

const INF = Number.POSITIVE_INFINITY;
/** Shared with the results page, so both show the same currency. */
const CURRENCY_KEY = 'display-currency';

interface PrefsForm {
  preferredTlds: string[];
  maxLength: number;
  allowHyphens: boolean;
  allowDigits: boolean;
  country: string;
  /** USD; Infinity = no upper limit */
  priceMin: number;
  priceMax: number;
}

const DEFAULT_PREFS: PrefsForm = {
  preferredTlds: [],
  maxLength: intake.preferenceDefaults.maxLength,
  allowHyphens: intake.preferenceDefaults.allowHyphens,
  allowDigits: intake.preferenceDefaults.allowDigits,
  country: 'auto',
  priceMin: 0,
  priceMax: INF,
};

type Text = Record<string, string>;
type T = (k: string, v?: Record<string, string | number>) => string;

/**
 * Light checks for instant feedback. The server validates the whole request with the shared schema and answers
 * with field messages, so nothing here is trusted (spec 001 tech §9).
 */
function toPreferences(f: PrefsForm, t: T, forceSearch = false): { prefs?: Preferences; error?: string } {
  const [minLen, maxLen] = intake.maxLabelLengthRange;
  const maxLength = Number(f.maxLength);
  if (!Number.isInteger(maxLength) || maxLength < minLen || maxLength > maxLen) {
    return { error: t('form.errorMaxLength', { min: minLen, max: maxLen }) };
  }
  const badTld = f.preferredTlds.find((tld) => !/^[a-z0-9-]+(\.[a-z0-9-]+)?$/.test(tld));
  if (badTld || f.preferredTlds.length > 20)
    return { error: t('form.errorTld', { tld: badTld ?? f.preferredTlds[20] ?? '' }) };
  return {
    prefs: {
      preferredTlds: f.preferredTlds,
      maxLength,
      allowHyphens: f.allowHyphens,
      allowDigits: f.allowDigits,
      country: f.country,
      priceMinCents: Math.round(f.priceMin * 100),
      priceMaxCents: f.priceMax === INF ? null : Math.round(f.priceMax * 100),
      includeFree: true,
      forceSearch,
    },
  };
}

function errorText(e: StartError, t: (k: string, v?: Record<string, number>) => string): string {
  switch (e.kind) {
    case 'validation':
      return Object.values(e.fields)[0] ?? t('form.errorGeneric');
    case 'human':
      return t('form.errorHuman');
    case 'limited':
      return t('form.errorLimited', { minutes: Math.max(1, Math.ceil(e.retryAfterSec / 60)) });
    case 'unavailable':
      return t('form.errorUnavailable');
    default:
      return t('form.errorGeneric');
  }
}

export function SearchForm({
  text,
  examples,
  countries,
  fx,
}: {
  text: Text;
  examples: readonly Example[];
  countries: Array<[string, string]>;
  /** Exchange-rate snapshot for showing the price range in the visitor's currency (approximate). */
  fx: FxTable;
}) {
  const t: T = (key, vars) => format(text[key.replace(/^form\./, '')], vars);
  const router = useRouter();
  const params = useSearchParams();
  const ids = {
    text: useId(),
    counter: useId(),
    error: useId(),
    price: useId(),
    currency: useId(),
    country: useId(),
    maxLen: useId(),
  };
  const [description, setDescription] = useState('');
  const [prefs, setPrefs] = useState<PrefsForm>(DEFAULT_PREFS);
  const [currency, setCurrency] = useState('USD');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const human = useRef<HumanCheckHandle>(null);

  // "Edit description" from the results page brings the text back from this tab's session (FR-INT-012).
  useEffect(() => {
    const ref = params.get('edit');
    if (!ref) return;
    void import('@/lib/client/search').then(({ recallInput }) => {
      const saved = recallInput(ref);
      if (saved) setDescription(saved.description);
    });
  }, [params]);

  // The visitor's currency: their earlier choice, else their region's (FR-PRC-010).
  useEffect(() => {
    let stored: string | null = null;
    try {
      stored = localStorage.getItem(CURRENCY_KEY);
    } catch {
      // storage blocked: use the region
    }
    setCurrency(
      stored && (stored === 'USD' || fx.rates[stored])
        ? stored
        : defaultCurrency(navigator.languages ?? [navigator.language], fx.rates),
    );
  }, [fx.rates]);

  function chooseCurrency(c: string) {
    setCurrency(c);
    try {
      localStorage.setItem(CURRENCY_KEY, c);
    } catch {
      // remembered for this page only
    }
  }

  const normalized = useMemo(() => normalize(description), [description]);
  const length = normalized.text.length;
  const tooLong = length > intake.descriptionMax;
  const removed = Object.entries(normalized.removed)
    .filter(([, v]) => v)
    .map(([k]) => t(`form.removed${k[0]!.toUpperCase()}${k.slice(1)}`));

  const money = (usd: number) => formatMoney(Math.round(usd * 100), currency, fx);
  const priceText =
    prefs.priceMin <= 0 && prefs.priceMax === INF
      ? t('form.priceAny')
      : prefs.priceMax === INF
        ? t('form.priceFrom', { min: money(prefs.priceMin) })
        : prefs.priceMin <= 0
          ? t('form.priceUpTo', { max: money(prefs.priceMax) })
          : t('form.priceBetween', { min: money(prefs.priceMin), max: money(prefs.priceMax) });
  const lo = usdToPosition(prefs.priceMin);
  const hi = usdToPosition(prefs.priceMax);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return; // one search per click (spec 001 edge case)
    setError(null);
    if (length < intake.descriptionMin) return setError(t('form.tooShort', { min: intake.descriptionMin }));
    if (tooLong) return setError(t('form.tooLong', { max: intake.descriptionMax }));
    const { prefs: preferences, error: prefError } = toPreferences(prefs, t);
    if (!preferences) return setError(prefError ?? t('form.errorGeneric'));
    setBusy(true);
    // The streaming client loads on submit, not with the page (NFR-INT-004).
    const [{ startSearch }, token] = await Promise.all([
      import('@/lib/client/search'),
      human.current?.token() ?? 'none',
    ]);
    const result = await startSearch({ description: normalized.text, preferences }, token);
    if ('ref' in result) {
      router.push(`/s/${result.ref}`);
      return;
    }
    setBusy(false);
    human.current?.reset();
    setError(errorText(result.error, t));
  }

  return (
    <form
      onSubmit={submit}
      noValidate
      className="card flex flex-col gap-6 p-5 shadow-[0_1px_2px_rgba(15,30,51,0.04),0_8px_24px_rgba(15,30,51,0.06)] sm:p-6"
      aria-describedby={error ? ids.error : undefined}
    >
      <div className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between gap-3">
          <label htmlFor={ids.text} className="font-semibold">
            {t('form.label')}
          </label>
          <span
            id={ids.counter}
            className={`text-[0.8125rem] tabular-nums ${tooLong ? 'font-semibold text-[var(--danger)]' : 'text-[var(--muted)]'}`}
            aria-live={tooLong ? 'polite' : 'off'}
          >
            {tooLong
              ? t('form.tooLong', { max: intake.descriptionMax })
              : t('form.counter', { count: length, max: intake.descriptionMax })}
          </span>
        </div>
        <textarea
          id={ids.text}
          name="description"
          rows={4}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          onFocus={() => human.current?.warmUp()}
          placeholder={t('form.placeholder')}
          aria-describedby={ids.counter}
          aria-invalid={tooLong || undefined}
          className="field min-h-28 resize-y leading-relaxed"
        />
        {removed.length > 0 && (
          <p className="text-sm text-[var(--muted)]" role="status">
            {t('form.removed', { what: removed.join(', ') })}
          </p>
        )}
      </div>

      <TldInput
        value={prefs.preferredTlds}
        onChange={(preferredTlds) => setPrefs((p) => ({ ...p, preferredTlds }))}
        text={t}
      />

      <div className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between gap-3">
          <span id={ids.price} className="font-semibold">
            {t('form.priceLabel')}
          </span>
          <output className="wordmark text-[0.95rem] tabular-nums" aria-live="off">
            {priceText}
          </output>
        </div>
        <div
          className="range-dual"
          role="group"
          aria-labelledby={ids.price}
          style={
            {
              '--lo': `${(lo / SLIDER_STEPS) * 100}%`,
              '--hi': `${(hi / SLIDER_STEPS) * 100}%`,
            } as React.CSSProperties
          }
        >
          <input
            type="range"
            min={0}
            max={SLIDER_STEPS}
            step={1}
            value={lo}
            aria-label={t('form.priceLow')}
            aria-valuetext={money(prefs.priceMin)}
            onChange={(e) => {
              const v = positionToUsd(Math.min(Number(e.target.value), hi - 1));
              setPrefs((p) => ({ ...p, priceMin: v }));
            }}
          />
          <input
            type="range"
            min={0}
            max={SLIDER_STEPS}
            step={1}
            value={hi}
            aria-label={t('form.priceHigh')}
            aria-valuetext={prefs.priceMax === INF ? t('form.priceNoLimit') : money(prefs.priceMax)}
            onChange={(e) => {
              const v = positionToUsd(Math.max(Number(e.target.value), lo + 1));
              setPrefs((p) => ({ ...p, priceMax: v }));
            }}
          />
        </div>
        <div className="flex justify-between text-xs text-[var(--muted)] tabular-nums" aria-hidden="true">
          <span>{money(0)}</span>
          <span>{money(10_000)}+</span>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <label htmlFor={ids.country} className="font-semibold">
            {t('form.country')}
          </label>
          <select
            id={ids.country}
            value={prefs.country}
            onChange={(e) => setPrefs((p) => ({ ...p, country: e.target.value }))}
            className="field"
          >
            <option value="auto">{t('form.countryAuto')}</option>
            <option value="global">{t('form.countryGlobal')}</option>
            {countries.map(([code, name]) => (
              <option key={code} value={code}>
                {name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-2">
          <label htmlFor={ids.currency} className="font-semibold">
            {t('form.currency')}
          </label>
          <select
            id={ids.currency}
            value={currency}
            onChange={(e) => chooseCurrency(e.target.value)}
            className="field"
          >
            {['USD', ...Object.keys(fx.rates).filter((c) => c !== 'USD')].sort().map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
      </div>
      {currency !== 'USD' && <p className="-mt-3 text-xs text-[var(--muted)]">{t('form.priceApprox')}</p>}

      <details className="more">
        <summary className="inline-flex cursor-pointer items-center gap-2 font-semibold text-[var(--accent)]">
          {t('form.moreOptions')}
        </summary>
        <div className="mt-4 grid items-end gap-4 sm:grid-cols-3">
          <div className="flex flex-col gap-2">
            <label htmlFor={ids.maxLen} className="text-sm font-semibold">
              {t('form.maxLength')}
            </label>
            <input
              id={ids.maxLen}
              type="number"
              min={intake.maxLabelLengthRange[0]}
              max={intake.maxLabelLengthRange[1]}
              value={prefs.maxLength}
              onChange={(e) => setPrefs((p) => ({ ...p, maxLength: Number(e.target.value) }))}
              className="field"
            />
          </div>
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="h-[1.1rem] w-[1.1rem] accent-[var(--accent)]"
              checked={prefs.allowHyphens}
              onChange={(e) => setPrefs((p) => ({ ...p, allowHyphens: e.target.checked }))}
            />
            {t('form.allowHyphens')}
          </label>
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="h-[1.1rem] w-[1.1rem] accent-[var(--accent)]"
              checked={prefs.allowDigits}
              onChange={(e) => setPrefs((p) => ({ ...p, allowDigits: e.target.checked }))}
            />
            {t('form.allowDigits')}
          </label>
        </div>
      </details>

      <HumanCheck ref={human} />

      {error && (
        <p
          id={ids.error}
          role="alert"
          className="rounded-[10px] border border-[var(--danger)] bg-[var(--danger-soft)] p-3 text-sm text-[var(--danger)]"
        >
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={busy || tooLong}
        aria-busy={busy || undefined}
        className="btn btn-primary w-full py-3.5 text-base"
      >
        {busy ? t('form.submitting') : t('form.submit')}
      </button>

      <div className="flex flex-wrap items-center gap-2 text-sm text-[var(--muted)]">
        <span>{t('form.examples')}</span>
        <ul className="contents">
          {examples.map((ex) => (
            <li key={ex.label}>
              <button
                type="button"
                onClick={() => setDescription(ex.description)}
                className="chip-toggle bg-[var(--bg)] text-[var(--fg)]"
              >
                {ex.label}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </form>
  );
}
