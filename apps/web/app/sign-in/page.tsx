import type { Metadata } from 'next';
import Link from 'next/link';
import { t } from '@/lib/i18n';
import { pageJar } from '@/lib/server/page-session';
import { services } from '@/lib/server/services';
import { safeNext } from '@/lib/server/session';

export const metadata: Metadata = { title: t('signIn.title'), robots: { index: false } };

// Spec 011 US-1 / §5.1: provider choice. Both buttons are plain links to the server, which redirects to the
// provider; nothing runs in the browser.
export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const { next: rawNext, error } = await searchParams;
  const next = safeNext(rawNext);
  const svc = services();
  const auth = svc.auth(await pageJar());
  const user = auth.available ? await auth.user().catch(() => null) : null;
  const href = (provider: string) => `/auth/sign-in?${new URLSearchParams({ provider, next })}`;
  const [beforeTerms, rest] = t('signIn.policies').split('{terms}');
  const [between, afterPrivacy] = (rest ?? '').split('{privacy}');

  return (
    <article className="mx-auto flex max-w-md flex-col gap-5">
      <h1 className="text-2xl font-semibold">{t('signIn.title')}</h1>
      {error && (
        <p role="alert" className="rounded-lg border border-[var(--danger)] p-3 text-sm">
          {error === 'unavailable' ? t('signIn.unavailable') : t('signIn.error')}
        </p>
      )}
      {!auth.available ? (
        <p>{t('signIn.unavailable')}</p>
      ) : (
        <>
          <p>{t('signIn.intro')}</p>
          {user?.isAnonymous && <p className="text-sm">{t('signIn.mergeNote')}</p>}
          <div className="flex flex-col gap-3">
            <a
              href={href('google')}
              className="rounded-lg border border-[var(--border)] px-4 py-3 text-center font-semibold"
            >
              {t('signIn.google')}
            </a>
            <a
              href={href('github')}
              className="rounded-lg border border-[var(--border)] px-4 py-3 text-center font-semibold"
            >
              {t('signIn.github')}
            </a>
          </div>
          <p className="text-sm text-[var(--muted)]">{t('signIn.noPassword')}</p>
          <p className="text-sm text-[var(--muted)]">
            {beforeTerms}
            <Link href="/terms" className="underline">
              {t('signIn.terms')}
            </Link>
            {between}
            <Link href="/privacy" className="underline">
              {t('signIn.privacy')}
            </Link>
            {afterPrivacy}
          </p>
        </>
      )}
    </article>
  );
}
