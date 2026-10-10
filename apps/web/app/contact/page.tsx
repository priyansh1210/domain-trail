import type { Metadata } from 'next';
import { serverEnv } from '@domains-all/config';
import { ContactForm } from '@/components/contact-form';
import { t } from '@/lib/i18n';

export const metadata: Metadata = { title: t('contact.title') };

// Spec 013 FR-PRIV-007: contact and grievance channel; answers within 30 days.
export default function ContactPage() {
  const env = serverEnv();
  return (
    <article className="mx-auto flex max-w-xl flex-col gap-4">
      <h1 className="text-2xl font-semibold">{t('contact.title')}</h1>
      <p>{t('contact.intro')}</p>
      <p className="text-sm">
        {t('contact.grievance', { name: env.GRIEVANCE_NAME, email: env.GRIEVANCE_EMAIL })}
      </p>
      <ContactForm />
      <p className="text-sm text-[var(--muted)]">{t('contact.privacy')}</p>
    </article>
  );
}
