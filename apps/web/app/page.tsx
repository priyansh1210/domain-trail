import { Suspense } from 'react';
import { EXAMPLES } from '@domains-all/core/client';
import { COUNTRIES } from '@domains-all/jev/catalog';
import fxSnapshot from '@domains-all/pricing/data/fx-rates.json';
import type { FxTable } from '@domains-all/pricing/client';
import { HeroGlobe } from '@/components/hero-globe';
import { SearchForm } from '@/components/search-form';
import { section, t } from '@/lib/i18n';

const COUNTRY_CHOICES = Object.entries(COUNTRIES).sort((a, b) => a[1].localeCompare(b[1]));
/** Approximate rates for the form's price range; results use the day's rates. */
const FX: FxTable = { base: 'USD', asOf: fxSnapshot.asOf, rates: fxSnapshot.rates };
const FACTS = ['1', '2', '3'] as const;

export default function HomePage() {
  return (
    <div className="page-wide flex flex-col gap-12">
      <section
        aria-labelledby="hero-title"
        className="grid items-center gap-10 min-[900px]:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]"
      >
        <div className="flex min-w-0 flex-col gap-4">
          <h1 id="hero-title" className="text-[clamp(1.9rem,4.2vw,2.9rem)] leading-[1.1]">
            {t('home.title')}
          </h1>
          <p className="max-w-[34em] text-lg text-[var(--muted)]">{t('home.lede')}</p>
          <noscript>
            <p className="rounded-lg border border-[var(--warn)] p-3">{t('form.noJs')}</p>
          </noscript>
          <div className="mt-3">
            <Suspense>
              <SearchForm text={section('form')} examples={EXAMPLES} countries={COUNTRY_CHOICES} fx={FX} />
            </Suspense>
          </div>
        </div>
        <HeroGlobe caption={t('home.globeCaption')} />
      </section>

      <section
        aria-label={t('home.factsLabel')}
        className="grid gap-5 border-t border-[var(--border)] pt-7 sm:grid-cols-3 sm:gap-0"
      >
        {FACTS.map((n, i) => (
          <div
            key={n}
            className={`flex flex-col gap-1 sm:px-6 ${i === 0 ? 'sm:pl-0' : 'sm:border-l sm:border-[var(--border)]'}`}
          >
            <p className="wordmark text-[1.6rem] leading-tight">{t(`home.fact${n}Title`)}</p>
            <p className="text-sm text-[var(--muted)]">{t(`home.fact${n}`)}</p>
          </div>
        ))}
      </section>
    </div>
  );
}
