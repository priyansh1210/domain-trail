import type { Metadata } from 'next';
import { messages, t, tList } from '@/lib/i18n';
import { services } from '@/lib/server/services';
import { DATASETS, STALE_AFTER_HOURS, type StatusReport, statusSource } from '@/lib/server/status';

export const metadata: Metadata = { title: t('status.title') };

// Spec 009 tech §6: rebuilt at most every 5 minutes, so views do not hit the database.
export const revalidate = 300;

let getStatus: ReturnType<typeof statusSource> | undefined;

function ago(hours: number | null): string {
  if (hours === null) return t('status.notYet');
  if (hours < 1) return t('status.agoUnderHour');
  if (hours < 48) return t('status.agoHours', { n: Math.round(hours) });
  return t('status.agoDays', { n: Math.round(hours / 24) });
}

const serviceState = (s: string) => (messages.status.serviceStates as Record<string, string>)[s] ?? s;

export default async function StatusPage() {
  getStatus ??= statusSource(services());
  const status: StatusReport = await getStatus();
  const names = messages.status.names as Record<string, string>;
  const serviceNames = messages.status.serviceNames as Record<string, string>;

  return (
    <article className="flex flex-col gap-8">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">{t('status.title')}</h1>
        <p>{t('status.intro', { hours: STALE_AFTER_HOURS.prices })}</p>
        <p className="text-sm text-[var(--muted)]">
          {t('status.generated', { time: status.generatedAt.slice(0, 16).replace('T', ' ') })}
        </p>
      </header>

      <section aria-labelledby="data-heading" className="flex flex-col gap-3">
        <h2 id="data-heading" className="text-lg font-semibold">
          {t('status.dataHeading')}
        </h2>
        <table className="w-full border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-[var(--border)]">
              <th scope="col" className="py-2 pr-4 font-medium">
                {t('status.dataset')}
              </th>
              <th scope="col" className="py-2 pr-4 font-medium">
                {t('status.updated')}
              </th>
              <th scope="col" className="py-2 font-medium">
                {t('status.state')}
              </th>
            </tr>
          </thead>
          <tbody>
            {DATASETS.map((d) => {
              const age = status.dataAges[d];
              const stale = status.stale.includes(d);
              return (
                <tr key={d} className="border-b border-[var(--border)]" data-dataset={d}>
                  <th scope="row" className="py-2 pr-4 font-normal">
                    {names[d]}
                  </th>
                  <td className="py-2 pr-4">{ago(age)}</td>
                  <td className={`py-2 ${stale ? 'font-medium text-[var(--warn)]' : ''}`}>
                    {age === null ? t('status.notYet') : stale ? t('status.staleLabel') : t('status.fresh')}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <section aria-labelledby="services-heading" className="flex flex-col gap-3">
        <h2 id="services-heading" className="text-lg font-semibold">
          {t('status.servicesHeading')}
        </h2>
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
          {(Object.keys(status.services) as Array<keyof StatusReport['services']>).map((k) => (
            <div key={k} className="contents">
              <dt>{serviceNames[k]}</dt>
              <dd className={status.services[k] === 'ok' ? '' : 'text-[var(--warn)]'}>
                {serviceState(status.services[k])}
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <section aria-labelledby="jobs-heading" className="flex flex-col gap-3">
        <h2 id="jobs-heading" className="text-lg font-semibold">
          {t('status.jobsHeading')}
        </h2>
        {status.jobs.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">{t('status.noJobs')}</p>
        ) : (
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-[var(--border)]">
                <th scope="col" className="py-2 pr-4 font-medium">
                  {t('status.jobsHeading')}
                </th>
                <th scope="col" className="py-2 pr-4 font-medium">
                  {t('status.jobLast')}
                </th>
                <th scope="col" className="py-2 font-medium">
                  {t('status.jobFailures')}
                </th>
              </tr>
            </thead>
            <tbody>
              {status.jobs.map((j) => (
                <tr key={j.job} className="border-b border-[var(--border)]">
                  <th scope="row" className="py-2 pr-4 font-mono font-normal">
                    {j.job}
                  </th>
                  <td className="py-2 pr-4">
                    {ago(
                      j.lastSuccessAt
                        ? (Date.parse(status.generatedAt) - Date.parse(j.lastSuccessAt)) / 3600_000
                        : null,
                    )}
                  </td>
                  <td className={`py-2 ${j.failuresInRow > 0 ? 'text-[var(--warn)]' : ''}`}>
                    {j.failuresInRow}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section aria-labelledby="sources-heading" className="flex flex-col gap-3">
        <h2 id="sources-heading" className="text-lg font-semibold">
          {t('status.sourcesHeading')}
        </h2>
        <ul className="list-disc pl-6 text-sm">
          {tList('status.sources').map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ul>
      </section>
    </article>
  );
}
