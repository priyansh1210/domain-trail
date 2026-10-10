import type { Metadata } from 'next';
import { WelcomeForm } from '@/components/account/welcome-form';
import { t } from '@/lib/i18n';
import { safeNext } from '@/lib/server/session';

export const metadata: Metadata = { title: t('welcome.title'), robots: { index: false } };

export default async function WelcomePage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  return (
    <article className="mx-auto flex max-w-md flex-col gap-4">
      <h1 className="text-2xl font-semibold">{t('welcome.title')}</h1>
      <p>{t('welcome.intro')}</p>
      <WelcomeForm next={safeNext(next)} />
    </article>
  );
}
