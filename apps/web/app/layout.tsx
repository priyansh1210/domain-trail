import type { Metadata } from 'next';
import Link from 'next/link';
import Script from 'next/script';
import type { ReactNode } from 'react';
import { siteIdentity } from '@domains-all/config';
import { AccountLink } from '@/components/account-link';
import { DataAge } from '@/components/data-age';
import { t } from '@/lib/i18n';
import './globals.css';

const site = siteIdentity();
/** Cloudflare Web Analytics: cookieless page counts (spec 009, FR-PRIV-003); only when the owner sets a token. */
const CF_ANALYTICS = process.env.NEXT_PUBLIC_CF_ANALYTICS_TOKEN;

export const metadata: Metadata = {
  metadataBase: site.url,
  title: { default: site.name, template: `%s · ${site.name}` },
  description: t('home.tagline'),
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="flex min-h-dvh flex-col antialiased">
        <header className="border-b border-[var(--border)]">
          <div className="mx-auto flex max-w-3xl items-center justify-between gap-4 px-4 py-3">
            <Link href="/" className="text-lg font-semibold">
              {site.name}
            </Link>
            <nav aria-label="Account" className="text-sm">
              <AccountLink />
            </nav>
          </div>
        </header>
        <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8">{children}</main>
        <footer className="border-t border-[var(--border)]">
          <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-3 px-4 py-4 text-sm text-[var(--muted)]">
            <p>{t('footer.disclaimer')}</p>
            <nav aria-label="Footer" className="flex flex-wrap gap-4">
              <DataAge
                text={{
                  status: t('footer.status'),
                  dataAge: t('footer.dataAge'),
                  dataAgeStale: t('footer.dataAgeStale'),
                  hours: t('footer.ageHours'),
                  underHour: t('footer.ageUnderHour'),
                  days: t('footer.ageDays'),
                }}
              />
              <Link href="/privacy" className="underline">
                {t('footer.privacy')}
              </Link>
              <Link href="/terms" className="underline">
                {t('footer.terms')}
              </Link>
              <Link href="/contact" className="underline">
                {t('footer.contact')}
              </Link>
            </nav>
          </div>
        </footer>
        {CF_ANALYTICS && (
          <Script
            src="https://static.cloudflareinsights.com/beacon.min.js"
            strategy="afterInteractive"
            data-cf-beacon={JSON.stringify({ token: CF_ANALYTICS })}
          />
        )}
      </body>
    </html>
  );
}
