import type { Metadata } from 'next';
import { t, tList } from '@/lib/i18n';

export const metadata: Metadata = { title: t('policy.termsTitle') };

// Short summary until the full terms (spec 013 tech §5.8) are published in milestone M6.
export default function TermsPage() {
  return (
    <article className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">{t('policy.termsTitle')}</h1>
      <p className="text-sm text-[var(--muted)]">{t('policy.draft')}</p>
      <ul className="list-disc pl-6">
        {tList('policy.termsPoints').map((p) => (
          <li key={p}>{p}</li>
        ))}
      </ul>
    </article>
  );
}
