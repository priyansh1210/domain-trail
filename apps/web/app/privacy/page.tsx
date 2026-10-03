import type { Metadata } from 'next';
import { serverEnv } from '@domains-all/config';
import { t, tList } from '@/lib/i18n';

export const metadata: Metadata = { title: t('policy.privacyTitle') };

// Short summary until the full policy (spec 013 tech §5.7) is published in milestone M6.
export default function PrivacyPage() {
  const env = serverEnv();
  return (
    <article className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">{t('policy.privacyTitle')}</h1>
      <p className="text-sm text-[var(--muted)]">{t('policy.draft')}</p>
      <ul className="list-disc pl-6">
        {tList('policy.privacyPoints').map((p) => (
          <li key={p}>{p}</li>
        ))}
      </ul>
      <p>{t('policy.grievance', { name: env.GRIEVANCE_NAME, email: env.GRIEVANCE_EMAIL })}</p>
    </article>
  );
}
