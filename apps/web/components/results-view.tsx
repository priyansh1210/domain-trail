'use client';
// Results page (spec 009 US-1…US-6; spec 006 US-2…US-6; spec 003 US-1, US-3; spec 001 US-4): progress, detected-
// feature chips, the price filter, sections with checked and priced names, banners and the disclaimer.
import type { Section } from '@domains-all/core/client';
import type { FxTable } from '@domains-all/pricing/client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { HumanCheck, type HumanCheckHandle } from '@/components/human-check';
import { ChipEditor } from '@/components/results/chip-editor';
import { PriceFilter } from '@/components/results/price-filter';
import { SaveSearchButton } from '@/components/results/save-controls';
import { bandFor, Sections } from '@/components/results/sections';
import { HumanTokenContext, loadSaved, signInHref, useAccount } from '@/lib/client/account';
import {
  ago,
  DEFAULT_FILTERS,
  defaultCurrency,
  type Filters,
  filtersFromParams,
  paramsFromFilters,
} from '@/lib/client/results';
import {
  findMore,
  loadSnapshot,
  recallInput,
  startSearch,
  useSearchStore,
  type SearchView,
} from '@/lib/client/search';
import { t } from '@/lib/i18n';
import { profileChips } from '@/lib/labels';

const USD_ONLY: FxTable = { base: 'USD', asOf: '', rates: { USD: 1 } };
const CURRENCY_KEY = 'display-currency';

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
  const order = ['features', 'names', 'availability', 'done'] as const;
  const at = order.indexOf(view.stage ?? 'features');
  const stages = [
    { key: 'stageFeatures', i: 0 },
    { key: 'stageNames', i: 1 },
    { key: 'stageAvailability', i: 2 },
    { key: 'stagePricing', i: 2 },
  ];
  return (
    <ol className="flex flex-wrap gap-x-6 gap-y-2 text-sm" aria-label="Progress">
      {stages.map((s) => {
        const state = at > s.i || at === 3 ? 'done' : at === s.i ? 'active' : 'later';
        return (
          <li
            key={s.key}
            className={state === 'later' ? 'text-[var(--muted)]' : 'font-medium'}
            aria-current={state === 'active' ? 'step' : undefined}
          >
            <span aria-hidden="true">{state === 'done' ? '✓ ' : state === 'active' ? '… ' : '○ '}</span>
            {t(`results.${s.key}`)}
          </li>
        );
      })}
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

/** Polite announcements, at most every 5 seconds (spec 009 US-5). */
function useAnnouncer(view: SearchView | undefined): string {
  const [text, setText] = useState('');
  const announced = useRef(0);
  const last = useRef(0);
  const count = Object.keys(view?.results ?? {}).length;
  const done = view?.stage === 'done';
  useEffect(() => {
    if (view?.profile && announced.current === 0 && count === 0)
      setText(t('results.announceFeatures', { count: profileChips(view.profile).length }));
  }, [view?.profile, count]);
  useEffect(() => {
    const now = Date.now();
    if (done) {
      setText(t('results.announceDone', { count }));
      announced.current = count;
      return;
    }
    if (count > announced.current && now - last.current >= 5000) {
      setText(t('results.announceResults', { count: count - announced.current }));
      announced.current = count;
      last.current = now;
    }
  }, [count, done]);
  return text;
}

export function ResultsView({ searchRef }: { searchRef: string }) {
  const router = useRouter();
  const view = useSearchStore((s) => s.byRef[searchRef]);
  const requested = useRef(false);
  const announce = useAnnouncer(view);
  const human = useRef<HumanCheckHandle>(null);
  const humanToken = useCallback(async () => (await human.current?.token()) ?? 'none', []);
  const session = useAccount((s) => s.session);
  const [editing, setEditing] = useState(false);
  const canEdit = Boolean(session?.user && !session.user.isAnonymous);

  // Saved names and searches of this browser (stars and the Save button show their state).
  useEffect(() => {
    void loadSaved();
  }, []);

  // Back from "Sign in to edit": open the editor (spec 011 FR-ACC-003, the started action continues).
  useEffect(() => {
    if (canEdit && new URLSearchParams(window.location.search).get('edit') === 'chips') setEditing(true);
  }, [canEdit]);

  // Filters live in the page address so links and reloads keep them (FR-PRC-007).
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [tab, setTab] = useState<Section>('budget');
  const [currency, setCurrency] = useState('USD');
  const [findMoreNote, setFindMoreNote] = useState('');
  const urlLoaded = useRef(false);
  const fx = view?.pricing?.fx ?? USD_ONLY;

  useEffect(() => {
    const parsed = filtersFromParams(new URLSearchParams(window.location.search));
    const { cur, tab: urlTab, ...f } = parsed;
    setFilters(f);
    if (urlTab) setTab(urlTab);
    let stored: string | null = null;
    try {
      stored = localStorage.getItem(CURRENCY_KEY);
    } catch {
      // storage blocked: default below
    }
    if (cur ?? stored) setCurrency((cur ?? stored)!);
    urlLoaded.current = true;
  }, []);

  // Default currency from the browser's region once rates are known (FR-PRC-010).
  useEffect(() => {
    if (!view?.pricing) return;
    let stored: string | null = null;
    try {
      stored = localStorage.getItem(CURRENCY_KEY);
    } catch {
      // ignore
    }
    if (!new URLSearchParams(window.location.search).get('cur') && !stored)
      setCurrency(defaultCurrency(navigator.languages ?? [navigator.language], view.pricing.fx.rates));
  }, [view?.pricing]);

  useEffect(() => {
    if (!urlLoaded.current) return;
    const timer = setTimeout(() => {
      const qs = paramsFromFilters({ ...filters, cur: currency, tab });
      window.history.replaceState(null, '', qs ? `?${qs}` : window.location.pathname);
    }, 300);
    return () => clearTimeout(timer);
  }, [filters, currency, tab]);

  const chooseCurrency = useCallback((c: string) => {
    setCurrency(c);
    try {
      localStorage.setItem(CURRENCY_KEY, c);
    } catch {
      // remembered for this page only
    }
  }, []);

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

  async function searchAnyway() {
    const input = recallInput(searchRef);
    if (!input) return;
    const r = await startSearch(
      { ...input, preferences: { ...input.preferences, forceSearch: true } },
      'none',
    );
    if ('ref' in r) router.push(`/s/${r.ref}`);
  }

  async function onFindMore(section: Section) {
    setFindMoreNote('');
    const outcome = await findMore(
      searchRef,
      { ...bandFor(section, filters), basis: filters.basis },
      await humanToken(),
    );
    if (outcome === 'no_description') setFindMoreNote(t('results.findMoreUnavailable'));
    else if (outcome === 'limited') setFindMoreNote(t('results.findMoreLimited'));
    else if (outcome === 'error') setFindMoreNote(t('form.errorGeneric'));
  }

  const phase = view?.phase ?? 'starting';
  const pricesAgo = useMemo(
    () => (view?.pricing?.pricesAt ? ago(view.pricing.pricesAt) : undefined),
    [view?.pricing?.pricesAt],
  );
  const notices = view?.notices ?? [];
  const showResults = Boolean(view?.profile) && view?.stage !== 'names' && view?.stage !== 'features';

  const suggestedTitle = view?.profile
    ? profileChips(view.profile)
        .slice(0, 2)
        .map((c) => c.label)
        .join(' · ')
    : t('results.saveSearch');

  return (
    <HumanTokenContext.Provider value={humanToken}>
      <div className="flex flex-col gap-6">
        <HumanCheck ref={human} />
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
        {notices.includes('avl_paused') && <Banner tone="warn">{t('results.avlPaused')}</Banner>}
        {notices.includes('stale_prices') && <Banner tone="warn">{t('results.stalePrices')}</Banner>}
        {notices.includes('partial') && <Banner tone="warn">{t('results.partial')}</Banner>}

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
              <div className="flex flex-wrap items-start justify-between gap-3">
                <h2 id="understood-title" className="text-lg font-semibold">
                  {t('results.understood')}
                </h2>
                {view?.profile && phase === 'done' && (
                  <SaveSearchButton searchRef={searchRef} suggestedTitle={suggestedTitle} />
                )}
              </div>
              {editing && view?.profile ? (
                <ChipEditor profile={view.profile} searchRef={searchRef} onCancel={() => setEditing(false)} />
              ) : (
                <>
                  <Chips view={view ?? { phase: 'starting' }} />
                  {view?.profile && session?.available && (
                    <p className="text-sm">
                      {canEdit ? (
                        <button type="button" className="underline" onClick={() => setEditing(true)}>
                          {t('results.editChips')}
                        </button>
                      ) : (
                        <Link href={signInHref(`/s/${searchRef}?edit=chips`)} className="underline">
                          {t('results.signInToEdit')}
                        </Link>
                      )}
                    </p>
                  )}
                </>
              )}
            </section>

            {view?.profile && !showResults && (
              <ul className="flex flex-col gap-2" aria-hidden="true">
                {Array.from({ length: 4 }, (_, i) => (
                  <li key={i} className="h-28 animate-pulse rounded-lg bg-[var(--surface)]" />
                ))}
              </ul>
            )}

            {showResults && view && (
              <>
                <PriceFilter
                  filters={filters}
                  onChange={setFilters}
                  currency={currency}
                  onCurrency={chooseCurrency}
                  fx={fx}
                  showPremium={false}
                />
                {notices.includes('low_supply') && (
                  <p className="text-sm text-[var(--muted)]">{t('results.lowSupply')}</p>
                )}
                <Sections
                  view={view}
                  searchRef={searchRef}
                  filters={filters}
                  currency={currency}
                  fx={fx}
                  tab={tab}
                  onTab={setTab}
                  onResetRange={() => setFilters({ ...filters, min: 0, max: Number.POSITIVE_INFINITY })}
                  onFindMore={onFindMore}
                  findMoreNote={findMoreNote}
                />
              </>
            )}

            <footer className="flex flex-col gap-1 border-t border-[var(--border)] pt-3 text-xs text-[var(--muted)]">
              {view?.pricing && pricesAgo && (
                <p>
                  {t('results.pricesUpdated', {
                    ago: t(`results.ago.${pricesAgo.key}`, { n: pricesAgo.n }),
                    source: view.pricing.source,
                  })}
                </p>
              )}
              <p data-testid="disclaimer">{t('results.disclaimer')}</p>
            </footer>
          </>
        )}
      </div>
    </HumanTokenContext.Provider>
  );
}
