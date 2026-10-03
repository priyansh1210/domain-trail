'use client';
// Home page form (spec 001 US-1…US-4, FR-INT-001…005, 011, 014). Validation uses the same schema as the server.
import { intake } from '@domains-all/config/defaults';
import { normalize } from '@domains-all/core/client/normalize';
import type { Example, Preferences } from '@domains-all/core/client';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { StartError } from '@/lib/client/search';
import { format } from '@/lib/format';
import { HumanCheck, type HumanCheckHandle } from './human-check';

interface PrefsForm {
  preferredTlds: string;
  maxLength: number;
  allowHyphens: boolean;
  allowDigits: boolean;
  country: string;
  priceMin: string;
  priceMax: string;
}

const DEFAULT_PREFS: PrefsForm = {
  preferredTlds: '',
  maxLength: intake.preferenceDefaults.maxLength,
  allowHyphens: intake.preferenceDefaults.allowHyphens,
  allowDigits: intake.preferenceDefaults.allowDigits,
  country: 'auto',
  priceMin: '',
  priceMax: '',
};

type Text = Record<string, string>;

/**
 * Light checks for instant feedback. The server validates the whole request with the shared schema and answers
 * with field messages, so nothing here is trusted (spec 001 tech §9).
 */
function toPreferences(
  f: PrefsForm,
  t: (k: string, v?: Record<string, string | number>) => string,
  forceSearch = false,
): { prefs?: Preferences; error?: string } {
  const [minLen, maxLen] = intake.maxLabelLengthRange;
  const maxLength = Number(f.maxLength);
  if (!Number.isInteger(maxLength) || maxLength < minLen || maxLength > maxLen) {
    return { error: t('form.errorMaxLength', { min: minLen, max: maxLen }) };
  }
  const preferredTlds = f.preferredTlds
    .split(/[,\s]+/)
    .map((s) => s.trim().toLowerCase().replace(/^\./, ''))
    .filter(Boolean);
  const badTld = preferredTlds.find((tld) => !/^[a-z0-9-]+(\.[a-z0-9-]+)?$/.test(tld));
  if (badTld || preferredTlds.length > 20)
    return { error: t('form.errorTld', { tld: badTld ?? preferredTlds[20] ?? '' }) };
  const cents = (s: string) => (s.trim() === '' ? null : Math.round(Number(s) * 100));
  const priceMinCents = cents(f.priceMin) ?? 0;
  const priceMaxCents = cents(f.priceMax);
  if (
    !Number.isFinite(priceMinCents) ||
    priceMinCents < 0 ||
    (priceMaxCents !== null && (!Number.isFinite(priceMaxCents) || priceMaxCents < priceMinCents))
  ) {
    return { error: t('form.errorPrice') };
  }
  return {
    prefs: {
      preferredTlds,
      maxLength,
      allowHyphens: f.allowHyphens,
      allowDigits: f.allowDigits,
      country: f.country,
      priceMinCents,
      priceMaxCents,
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
}: {
  text: Text;
  examples: readonly Example[];
  countries: Array<[string, string]>;
}) {
  const t = (key: string, vars?: Record<string, string | number>) =>
    format(text[key.replace(/^form\./, '')], vars);
  const router = useRouter();
  const params = useSearchParams();
  const ids = { text: useId(), counter: useId(), error: useId() };
  const [description, setDescription] = useState('');
  const [prefs, setPrefs] = useState<PrefsForm>(DEFAULT_PREFS);
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

  const normalized = useMemo(() => normalize(description), [description]);
  const length = normalized.text.length;
  const tooLong = length > intake.descriptionMax;
  const removed = Object.entries(normalized.removed)
    .filter(([, v]) => v)
    .map(([k]) => t(`form.removed${k[0]!.toUpperCase()}${k.slice(1)}`));

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
      className="flex flex-col gap-4"
      aria-describedby={error ? ids.error : undefined}
    >
      <label htmlFor={ids.text} className="text-lg font-medium">
        {t('form.label')}
      </label>
      <textarea
        id={ids.text}
        name="description"
        rows={5}
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        onFocus={() => human.current?.warmUp()}
        placeholder={t('form.placeholder')}
        aria-describedby={ids.counter}
        aria-invalid={tooLong || undefined}
        className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3 text-base focus:outline-2 focus:outline-[var(--accent)]"
      />
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <span
          id={ids.counter}
          className={tooLong ? 'font-semibold text-[var(--danger)]' : 'text-[var(--muted)]'}
          aria-live={tooLong ? 'polite' : 'off'}
        >
          {tooLong
            ? t('form.tooLong', { max: intake.descriptionMax })
            : t('form.counter', { count: length, max: intake.descriptionMax })}
        </span>
      </div>
      {removed.length > 0 && (
        <p className="text-sm text-[var(--muted)]" role="status">
          {t('form.removed', { what: removed.join(', ') })}
        </p>
      )}

      <div>
        <p className="mb-2 text-sm text-[var(--muted)]">{t('form.examples')}</p>
        <ul className="flex flex-wrap gap-2">
          {examples.map((ex) => (
            <li key={ex.label}>
              <button
                type="button"
                onClick={() => setDescription(ex.description)}
                className="rounded-full border border-[var(--border)] px-3 py-1 text-sm hover:bg-[var(--surface)] focus:outline-2 focus:outline-[var(--accent)]"
              >
                {ex.label}
              </button>
            </li>
          ))}
        </ul>
      </div>

      <details className="rounded-lg border border-[var(--border)] p-3">
        <summary className="cursor-pointer font-medium">{t('form.moreOptions')}</summary>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm sm:col-span-2">
            {t('form.preferredTlds')}
            <input
              type="text"
              value={prefs.preferredTlds}
              onChange={(e) => setPrefs({ ...prefs, preferredTlds: e.target.value })}
              className="rounded border border-[var(--border)] bg-[var(--surface)] p-2"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            {t('form.maxLength')}
            <input
              type="number"
              min={intake.maxLabelLengthRange[0]}
              max={intake.maxLabelLengthRange[1]}
              value={prefs.maxLength}
              onChange={(e) => setPrefs({ ...prefs, maxLength: Number(e.target.value) })}
              className="rounded border border-[var(--border)] bg-[var(--surface)] p-2"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            {t('form.country')}
            <select
              value={prefs.country}
              onChange={(e) => setPrefs({ ...prefs, country: e.target.value })}
              className="rounded border border-[var(--border)] bg-[var(--surface)] p-2"
            >
              <option value="auto">{t('form.countryAuto')}</option>
              <option value="global">{t('form.countryGlobal')}</option>
              {countries.map(([code, name]) => (
                <option key={code} value={code}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={prefs.allowHyphens}
              onChange={(e) => setPrefs({ ...prefs, allowHyphens: e.target.checked })}
            />
            {t('form.allowHyphens')}
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={prefs.allowDigits}
              onChange={(e) => setPrefs({ ...prefs, allowDigits: e.target.checked })}
            />
            {t('form.allowDigits')}
          </label>
          <label className="flex flex-col gap-1 text-sm">
            {t('form.priceMin')}
            <input
              type="number"
              min={0}
              inputMode="decimal"
              value={prefs.priceMin}
              onChange={(e) => setPrefs({ ...prefs, priceMin: e.target.value })}
              className="rounded border border-[var(--border)] bg-[var(--surface)] p-2"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            {t('form.priceMax')}
            <input
              type="number"
              min={0}
              inputMode="decimal"
              value={prefs.priceMax}
              onChange={(e) => setPrefs({ ...prefs, priceMax: e.target.value })}
              className="rounded border border-[var(--border)] bg-[var(--surface)] p-2"
            />
          </label>
        </div>
      </details>

      <HumanCheck ref={human} />

      {error && (
        <p
          id={ids.error}
          role="alert"
          className="rounded-lg border border-[var(--danger)] p-3 text-sm text-[var(--danger)]"
        >
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={busy || tooLong}
        aria-busy={busy || undefined}
        className="rounded-lg bg-[var(--accent)] px-5 py-3 text-base font-semibold text-[var(--on-accent)] disabled:opacity-60"
      >
        {busy ? t('form.submitting') : t('form.submit')}
      </button>
    </form>
  );
}
