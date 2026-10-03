import type { Metadata } from 'next';
import Link from 'next/link';
import { ResultsView } from '@/components/results-view';
import { t } from '@/lib/i18n';

// FR-UX-016: result pages are never indexed.
export const metadata: Metadata = { title: t('results.title'), robots: { index: false, follow: false } };

export default async function ResultsPage({ params }: { params: Promise<{ ref: string }> }) {
  const { ref } = await params;
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">{t('results.title')}</h1>
        <Link href="/" className="text-sm underline">
          {t('results.newSearch')}
        </Link>
      </div>
      <ResultsView searchRef={decodeURIComponent(ref)} />
    </div>
  );
}
