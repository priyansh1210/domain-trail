import { Suspense } from 'react';
import { siteIdentity } from '@domains-all/config';
import { SearchForm } from '@/components/search-form';
import { EXAMPLES } from '@domains-all/core/client';
import { COUNTRIES } from '@domains-all/jev/catalog';
import { section, t } from '@/lib/i18n';

const COUNTRY_CHOICES = Object.entries(COUNTRIES).sort((a, b) => a[1].localeCompare(b[1]));

export default function HomePage() {
  const { name } = siteIdentity();
  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold">{name}</h1>
        <p className="text-lg text-[var(--muted)]">{t('home.tagline')}</p>
      </section>
      <noscript>
        <p className="rounded-lg border border-[var(--warn)] p-3">{t('form.noJs')}</p>
      </noscript>
      <Suspense>
        <SearchForm text={section('form')} examples={EXAMPLES} countries={COUNTRY_CHOICES} />
      </Suspense>
      <section aria-labelledby="how-title" className="flex flex-col gap-2">
        <h2 id="how-title" className="text-lg font-semibold">
          {t('home.howTitle')}
        </h2>
        <ol className="list-decimal pl-6 text-[var(--muted)]">
          <li>{t('home.how1')}</li>
          <li>{t('home.how2')}</li>
          <li>{t('home.how3')}</li>
        </ol>
      </section>
    </div>
  );
}
