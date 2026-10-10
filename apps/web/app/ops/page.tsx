import type { Metadata } from 'next';
import Link from 'next/link';
import { jev, retention } from '@domains-all/config';
import { t } from '@/lib/i18n';
import { requireAdmin } from '@/lib/server/ops';

export const metadata: Metadata = { title: t('ops.title'), robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

const fmt = (n: number) => new Intl.NumberFormat('en').format(n);

/** Short "key=value" summary of a job's statistics (counts only, spec 010 §9). */
function statsText(stats: unknown): string {
  if (!stats || typeof stats !== 'object') return '';
  return Object.entries(stats as Record<string, unknown>)
    .filter(([, v]) => typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean')
    .slice(0, 8)
    .map(([k, v]) => `${k}=${String(v)}`)
    .join(' ');
}

export default async function OpsPage() {
  const store = await requireAdmin();
  const o = await store.opsOverview();
  return (
    <article className="flex flex-col gap-8">
      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="text-2xl font-semibold">{t('ops.title')}</h1>
        <Link href="/ops/saved" className="underline">
          {t('ops.savedLink')}
        </Link>
      </header>
      {store.kind === 'memory' && <p className="text-sm text-[var(--muted)]">{t('ops.noData')}</p>}

      <section aria-labelledby="meters" className="flex flex-col gap-2">
        <h2 id="meters" className="text-lg font-semibold">
          {t('ops.meters')}
        </h2>
        <p>{t('ops.jevTokens', { used: fmt(o.jevTokensThisMonth), limit: fmt(jev.monthlyTokenCap) })}</p>
        <p>
          {o.dbMb === null
            ? t('ops.dbUnknown')
            : t('ops.dbSize', { mb: o.dbMb, limit: retention.dbSizeLimitMb })}
        </p>
      </section>

      <section aria-labelledby="jobs" className="flex flex-col gap-2">
        <h2 id="jobs" className="text-lg font-semibold">
          {t('ops.jobs')}
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-[var(--border)]">
                <th scope="col" className="py-2 pr-3">
                  {t('ops.job')}
                </th>
                <th scope="col" className="py-2 pr-3">
                  {t('ops.status')}
                </th>
                <th scope="col" className="py-2 pr-3">
                  {t('ops.started')}
                </th>
                <th scope="col" className="py-2">
                  {t('ops.stats')}
                </th>
              </tr>
            </thead>
            <tbody>
              {o.jobs.map((j, i) => (
                <tr
                  key={`${j.job}-${j.startedAt}-${i}`}
                  className="border-b border-[var(--border)] align-top"
                >
                  <td className="py-2 pr-3 font-mono">{j.job}</td>
                  <td className={`py-2 pr-3 ${j.status === 'failed' ? 'text-[var(--danger)]' : ''}`}>
                    {j.status}
                  </td>
                  <td className="py-2 pr-3 whitespace-nowrap">
                    {j.startedAt.slice(0, 16).replace('T', ' ')}
                  </td>
                  <td className="py-2 font-mono text-xs break-all">{j.error ?? statsText(j.stats)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section aria-labelledby="reports" className="flex flex-col gap-2">
        <h2 id="reports" className="text-lg font-semibold">
          {t('ops.reports')}
        </h2>
        <ul className="list-disc pl-6 text-sm">
          {o.reports.map((r) => (
            <li key={`${r.kind}-${r.period}`}>
              {r.kind} · {r.period} · {r.createdAt.slice(0, 10)}
            </li>
          ))}
        </ul>
      </section>
    </article>
  );
}
