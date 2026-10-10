import type { Metadata } from 'next';
import Link from 'next/link';
import { t } from '@/lib/i18n';
import { requireAdmin } from '@/lib/server/ops';

export const metadata: Metadata = { title: t('ops.savedTitle'), robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

const day = (iso: string) => iso.slice(0, 10);

function Table({
  caption,
  head,
  rows,
}: {
  caption: string;
  head: string[];
  rows: Array<Array<string | number>>;
}) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-lg font-semibold">{caption}</h2>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-[var(--border)]">
              {head.map((h) => (
                <th key={h} scope="col" className="py-2 pr-3">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-b border-[var(--border)] align-top">
                {r.map((c, j) => (
                  <td key={j} className="py-2 pr-3 break-words">
                    {c}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// Spec 011 §5.8 (FR-ACC-020): read-only; disclosed in the Privacy Policy (FR-ACC-021). No export, no logging.
export default async function SavedAdminPage() {
  const store = await requireAdmin();
  const o = await store.adminOverview();
  return (
    <article className="flex flex-col gap-8" data-testid="admin-saved">
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h1 className="text-2xl font-semibold">{t('ops.savedTitle')}</h1>
          <Link href="/ops" className="underline">
            {t('ops.opsLink')}
          </Link>
        </div>
        <p className="text-sm text-[var(--muted)]">{t('ops.savedIntro')}</p>
      </header>
      <Table
        caption={t('ops.accounts')}
        head={[t('ops.owner'), t('ops.provider'), t('ops.created'), t('ops.savedSearches'), t('ops.watched')]}
        rows={o.accounts.map((a) => [
          a.label,
          a.anonymous ? t('ops.anonymous') : (a.provider ?? ''),
          day(a.createdAt),
          a.savedSearches,
          a.watched,
        ])}
      />
      <Table
        caption={t('ops.savedSearches')}
        head={[t('ops.owner'), t('ops.title_'), t('ops.descriptionCol'), t('ops.created')]}
        rows={o.savedSearches.map((s) => [s.owner, s.title, s.description ?? '—', day(s.createdAt)])}
      />
      <Table
        caption={t('ops.watched')}
        head={[t('ops.owner'), t('ops.name'), t('ops.lastStatus'), t('ops.created')]}
        rows={o.watched.map((w) => [w.owner, w.fqdn, w.lastStatus ?? '—', day(w.addedAt)])}
      />
      <Table
        caption={t('ops.perDay')}
        head={[t('ops.day'), t('ops.saves'), t('ops.watches')]}
        rows={o.perDay.map((d) => [d.day, d.saves, d.watches])}
      />
    </article>
  );
}
