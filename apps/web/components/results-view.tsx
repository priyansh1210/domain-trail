'use client';
// Results page shell for milestone M2 (spec 009 US-1, US-5; spec 003 US-1, US-3; spec 001 US-4): progress, the
// detected-feature chips, and the "add detail" / refusal / degraded messages. Names arrive in later milestones.
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { loadSnapshot, recallInput, startSearch, useSearchStore, type SearchView } from '@/lib/client/search';
import { t } from '@/lib/i18n';
import { profileChips } from '@/lib/labels';
import { useRouter } from 'next/navigation';

function Banner({ tone, children }: { tone: 'info' | 'warn' | 'danger'; children: React.ReactNode }) {
  const color = tone === 'danger' ? 'var(--danger)' : tone === 'warn' ? 'var(--warn)' : 'var(--accent)';
  return (
    <div
      role={tone === 'info' ? 'status' : 'alert'}
      className="rounded-lg border p-3 text-sm"
      style={{ borderColor: color }}
    >
      {children}
    </div>
  );
}

function Stages({ view }: { view: SearchView }) {
  const featuresDone = Boolean(view.profile);
  const stages = [
    { key: 'stageFeatures', state: featuresDone ? 'done' : 'active' },
    { key: 'stageNames', state: 'later' },
    { key: 'stageAvailability', state: 'later' },
    { key: 'stagePricing', state: 'later' },
  ];
  return (
    <ol className="flex flex-wrap gap-x-6 gap-y-2 text-sm" aria-label="Progress">
      {stages.map((s) => (
        <li
          key={s.key}
          className={s.state === 'later' ? 'text-[var(--muted)]' : 'font-medium'}
          aria-current={s.state === 'active' ? 'step' : undefined}
        >
          <span aria-hidden="true">{s.state === 'done' ? '✓ ' : s.state === 'active' ? '… ' : '○ '}</span>
          {t(`results.${s.key}`)}
        </li>
      ))}
    </ol>
  );
}

function Chips({ view }: { view: SearchView }) {
  if (!view.profile) {
    return (
      <ul className="flex flex-wrap gap-2" aria-hidden="true">
        {Array.from({ length: 7 }, (_, i) => (
          <li key={i} className="h-8 w-28 animate-pulse rounded-full bg-[var(--surface)]" />
        ))}
      </ul>
    );
  }
  const chips = profileChips(view.profile);
  return (
    <ul className="flex flex-wrap gap-2" data-testid="feature-chips">
      {chips.map((c) => (
        <li
          key={c.id}
          className={`rounded-full border px-3 py-1 text-sm ${c.unsure ? 'border-dashed border-[var(--warn)]' : 'border-[var(--border)]'}`}
          title={
            c.alternatives.length ? t('results.alternatives', { list: c.alternatives.join(', ') }) : undefined
          }
        >
          {c.kind && <span className="sr-only">{c.kind}: </span>}
          {c.label}
          {c.unsure && <span className="ml-1 text-xs text-[var(--warn)]">({t('results.unsure')})</span>}
          {c.unsure && c.alternatives.length > 0 && (
            <span className="sr-only">
              . {t('results.alternatives', { list: c.alternatives.join(', ') })}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

export function ResultsView({ searchRef }: { searchRef: string }) {
  const router = useRouter();
  const view = useSearchStore((s) => s.byRef[searchRef]);
  const [announce, setAnnounce] = useState('');
  const requested = useRef(false);

  // Reload or shared link: re-run from this tab's session if we still have the description, else load the snapshot.
  useEffect(() => {
    if (view || requested.current) return;
    requested.current = true;
    const input = recallInput(searchRef);
    if (input) {
      void startSearch(input, 'none').then((r) => {
        if ('ref' in r && r.ref !== searchRef) router.replace(`/s/${r.ref}`);
        if ('error' in r) void loadSnapshot(searchRef);
      });
    } else void loadSnapshot(searchRef);
  }, [view, searchRef, router]);

  useEffect(() => {
    if (view?.profile)
      setAnnounce(t('results.announceFeatures', { count: profileChips(view.profile).length }));
  }, [view?.profile]);

  async function searchAnyway() {
    const input = recallInput(searchRef);
    if (!input) return;
    const r = await startSearch(
      { ...input, preferences: { ...input.preferences, forceSearch: true } },
      'none',
    );
    if ('ref' in r) router.push(`/s/${r.ref}`);
  }

  const phase = view?.phase ?? 'starting';

  return (
    <div className="flex flex-col gap-6">
      <p className="sr-only" aria-live="polite">
        {announce}
      </p>

      {(phase === 'expired' || phase === 'not_found') && (
        <Banner tone="warn">
          {t(phase === 'expired' ? 'results.expired' : 'results.notFound')}{' '}
          <Link href="/" className="underline">
            {t('results.startNew')}
          </Link>
        </Banner>
      )}
      {phase === 'refused' && <Banner tone="danger">{t('results.refused')}</Banner>}
      {phase === 'error' && <Banner tone="danger">{t('form.errorGeneric')}</Banner>}
      {view?.degraded && (
        <Banner tone="warn">
          {t(view.degraded === 'budget' ? 'results.degradedBudget' : 'results.degradedJev')}
        </Banner>
      )}
      {view?.notSaved && <Banner tone="info">{t('results.notSaved')}</Banner>}

      {phase === 'needs_detail' && (
        <section
          aria-labelledby="detail-title"
          className="flex flex-col gap-3 rounded-lg border border-[var(--warn)] p-4"
        >
          <h2 id="detail-title" className="text-lg font-semibold">
            {t('results.needsDetailTitle')}
          </h2>
          <p>{t('results.needsDetailIntro')}</p>
          <ul className="list-disc pl-6">
            {(view?.hints ?? []).map((h) => (
              <li key={h}>{t(`results.hint_${h}`)}</li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-3">
            <Link
              href={`/?edit=${encodeURIComponent(searchRef)}`}
              className="rounded-lg bg-[var(--accent)] px-4 py-2 font-semibold text-[var(--on-accent)]"
            >
              {t('results.editDescription')}
            </Link>
            <button
              type="button"
              onClick={searchAnyway}
              className="rounded-lg border border-[var(--border)] px-4 py-2"
            >
              {t('results.searchAnyway')}
            </button>
          </div>
        </section>
      )}

      {phase !== 'refused' && phase !== 'needs_detail' && phase !== 'expired' && phase !== 'not_found' && (
        <>
          <Stages view={view ?? { phase: 'starting' }} />
          <section aria-labelledby="understood-title" className="flex flex-col gap-3">
            <h2 id="understood-title" className="text-lg font-semibold">
              {t('results.understood')}
            </h2>
            <Chips view={view ?? { phase: 'starting' }} />
          </section>
          {view?.profile && <p className="text-sm text-[var(--muted)]">{t('results.comingSoon')}</p>}
        </>
      )}
    </div>
  );
}
