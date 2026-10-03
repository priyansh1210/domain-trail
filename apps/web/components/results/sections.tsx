'use client';
// Sections Free · $1–100 · $101–300 · $300+ · Price at registrar (spec 009 FR-UX-002, 003, 007, 008; spec 006
// FR-PRC-003; spec 007 FR-FREE-008, 011): one vertical list on desktop, tabs on small screens, counts, "Show more",
// empty states with "Find more in this range" / "Reset range", and the "Free hosting addresses" group.
import type { ResultItem, Section } from '@domains-all/core/client';
import { type FxTable, sectionLabel, showPremiumSection, TIER_BOUNDS } from '@domains-all/pricing/client';
import { useState } from 'react';
import { type Filters, sectionItems } from '@/lib/client/results';
import type { SearchView } from '@/lib/client/search';
import { t } from '@/lib/i18n';
import { ResultCard } from './result-card';

const PAGE = 20;
const ORDER: Section[] = ['free', 'budget', 'mid', 'premium', 'unpriced'];

export function sectionTitle(s: Section, currency: string, fx: FxTable): string {
  if (s === 'free') return t('results.sectionFree');
  if (s === 'unpriced') return t('results.sectionUnpriced');
  return sectionLabel(s, currency, fx);
}

const countText = (n: number) => (n === 1 ? t('results.countOne') : t('results.count', { n }));

function Skeletons() {
  return (
    <ul className="flex flex-col gap-2" aria-hidden="true">
      {Array.from({ length: 3 }, (_, i) => (
        <li key={i} className="h-28 animate-pulse rounded-lg bg-[var(--surface)]" />
      ))}
    </ul>
  );
}

function CardList({
  items,
  searchRef,
  currency,
  fx,
}: {
  items: ResultItem[];
  searchRef: string;
  currency: string;
  fx: FxTable;
}) {
  const [shown, setShown] = useState(PAGE);
  return (
    <>
      <ol className="flex flex-col gap-2">
        {items.slice(0, shown).map((r) => (
          <ResultCard key={r.fqdn} item={r} searchRef={searchRef} currency={currency} fx={fx} />
        ))}
      </ol>
      {items.length > shown && (
        <button
          type="button"
          onClick={() => setShown((n) => n + PAGE)}
          className="self-start rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm"
        >
          {t('results.showMore')}
        </button>
      )}
    </>
  );
}

export function Sections({
  view,
  searchRef,
  filters,
  currency,
  fx,
  tab,
  onTab,
  onResetRange,
  onFindMore,
  findMoreNote,
}: {
  view: SearchView;
  searchRef: string;
  filters: Filters;
  currency: string;
  fx: FxTable;
  tab: Section;
  onTab: (s: Section) => void;
  onResetRange: () => void;
  onFindMore: (section: Section) => void;
  findMoreNote: string;
}) {
  const results = view.results ?? {};
  const done = view.stage === 'done' || view.phase === 'done';
  const items = Object.fromEntries(
    ORDER.map((s) => [s, sectionItems(s, results, view.sections?.[s], filters)]),
  ) as Record<Section, ResultItem[]>;
  const unfiltered = (s: Section) => Object.values(results).some((r) => r.section === s);
  const visible = ORDER.filter(
    (s) =>
      (s !== 'premium' ||
        showPremiumSection(items.premium.length, { premiumProviders: [], aftermarketProviders: [] })) &&
      (s !== 'free' || filters.includeFree),
  );
  const current = visible.includes(tab) ? tab : (visible.find((s) => items[s].length) ?? visible[0]!);

  return (
    <div className="flex flex-col gap-4">
      {/* Small screens: one tab per section with its count (FR-UX-003). */}
      <div
        role="tablist"
        aria-label={t('results.sectionsNav')}
        className="flex gap-2 overflow-x-auto md:hidden"
      >
        {visible.map((s) => (
          <button
            key={s}
            role="tab"
            type="button"
            id={`tab-${s}`}
            aria-selected={current === s}
            aria-controls={`section-${s}`}
            onClick={() => onTab(s)}
            className={`shrink-0 rounded-full border px-3 py-1 text-sm ${current === s ? 'border-[var(--accent)] font-semibold' : 'border-[var(--border)]'}`}
          >
            {sectionTitle(s, currency, fx)} ({items[s].length})
          </button>
        ))}
      </div>

      {visible.map((s) => {
        const list = items[s];
        const free = s === 'free';
        const priced = s === 'budget' || s === 'mid' || s === 'premium';
        const main = free ? list.filter((r) => r.free?.kind !== 'platform_address') : list;
        const hosting = free ? list.filter((r) => r.free?.kind === 'platform_address') : [];
        return (
          <section
            key={s}
            id={`section-${s}`}
            aria-labelledby={`heading-${s}`}
            className={`flex flex-col gap-3 ${current === s ? '' : 'hidden md:flex'}`}
            data-testid={`section-${s}`}
          >
            <h2 id={`heading-${s}`} className="flex items-baseline gap-2 text-lg font-semibold">
              {sectionTitle(s, currency, fx)}
              <span className="text-sm font-normal text-[var(--muted)]" data-testid="section-count">
                {countText(list.length)}
              </span>
            </h2>
            {free && <p className="text-sm text-[var(--muted)]">{t('results.freeIntro')}</p>}
            {s === 'unpriced' && list.length > 0 && (
              <p className="text-sm text-[var(--muted)]">{t('results.unpricedNote')}</p>
            )}

            {list.length === 0 ? (
              !done ? (
                <Skeletons />
              ) : (
                <div className="flex flex-col items-start gap-2 rounded-lg border border-dashed border-[var(--border)] p-3 text-sm">
                  <p>
                    {unfiltered(s)
                      ? t('results.emptyFiltered')
                      : free
                        ? t('results.emptyFree')
                        : t('results.emptyPriced')}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {unfiltered(s) && (
                      <button
                        type="button"
                        onClick={onResetRange}
                        className="rounded-lg border border-[var(--border)] px-3 py-1.5"
                      >
                        {t('results.resetRange')}
                      </button>
                    )}
                    {priced && (
                      <button
                        type="button"
                        onClick={() => onFindMore(s)}
                        disabled={view.findingMore}
                        className="rounded-lg border border-[var(--border)] px-3 py-1.5 disabled:opacity-60"
                      >
                        {view.findingMore ? t('results.findingMore') : t('results.findMore')}
                      </button>
                    )}
                  </div>
                </div>
              )
            ) : (
              <>
                {main.length > 0 && (
                  <CardList items={main} searchRef={searchRef} currency={currency} fx={fx} />
                )}
                {hosting.length > 0 && (
                  <div className="flex flex-col gap-2" data-testid="free-hosting">
                    <h3 className="font-semibold">{t('results.hostingTitle')}</h3>
                    <p className="text-sm text-[var(--muted)]">{t('results.hostingNote')}</p>
                    <CardList items={hosting} searchRef={searchRef} currency={currency} fx={fx} />
                  </div>
                )}
                {priced && done && list.length < 5 && (
                  <button
                    type="button"
                    onClick={() => onFindMore(s)}
                    disabled={view.findingMore}
                    className="self-start rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm disabled:opacity-60"
                  >
                    {view.findingMore ? t('results.findingMore') : t('results.findMore')}
                  </button>
                )}
              </>
            )}
            {findMoreNote && priced && (
              <p role="status" className="text-sm text-[var(--warn)]">
                {findMoreNote}
              </p>
            )}
          </section>
        );
      })}
    </div>
  );
}

/** The band "Find more" asks for: the section's range narrowed by the current filter (FR-PRC-009). */
export function bandFor(section: Section, f: Filters): { minCents: number; maxCents: number | null } {
  const [lo, hi] = section === 'free' || section === 'unpriced' ? [0, null] : TIER_BOUNDS[section];
  const minCents = Math.max(lo, Math.round(f.min * 100));
  const fMax = f.max === Number.POSITIVE_INFINITY ? null : Math.round(f.max * 100);
  const maxCents = hi === null ? fMax : fMax === null ? hi : Math.min(hi, fMax);
  return { minCents, maxCents: maxCents !== null && maxCents < minCents ? minCents : maxCents };
}
