// Shared tail of a search stream: availability checks, prices and sections (stages S7–S9), streamed as `pricing`,
// `batch`, `update` and `notice` events (spec 009 tech §4.1). Used by the first search and by "find more".
import { availability } from '@domains-all/config';
import {
  isWord,
  type NamesOutcome,
  type ResultItem,
  runVerify,
  type Section,
  SECTIONS,
  type SiteProfile,
} from '@domains-all/core';
import { isStale, priceAgeHours } from '@domains-all/pricing';
import type { Services } from './services';
import type { EventSink } from './sse';
import type { StoredResults } from './store';

export interface VerifyStreamResult {
  stored: StoredResults;
  counts: Record<Section, number>;
  dataAgeHours: number;
  stats: Awaited<ReturnType<typeof runVerify>>['stats'];
}

/** Shown results per section: the final lists after the variety rules (FR-UX-003). */
export function countBySection(
  sections: Partial<Record<Section, readonly string[]>>,
): Record<Section, number> {
  return Object.fromEntries(SECTIONS.map((s) => [s, sections[s]?.length ?? 0])) as Record<Section, number>;
}

/** Sends the price book facts the page needs to show money in any currency (FR-PRC-010, FR-PRC-011). */
export function sendPricing(sink: EventSink, svc: Services) {
  const book = svc.prices.get();
  const stale = isStale(book);
  sink.send('pricing', { fx: book.fx, pricesAt: book.pricesAt, source: book.provider.name, stale });
  if (stale)
    sink.send('notice', {
      code: 'stale_prices',
      message: 'Prices could not be refreshed recently; they may be out of date.',
    });
  return book;
}

export async function streamVerify(
  sink: EventSink,
  svc: Services,
  args: {
    names: NamesOutcome;
    profile: SiteProfile;
    includeFree: boolean;
    allowHyphens: boolean;
    /** Keep only results that pass (find more: in the price band, not shown before). */
    keep?: (item: ResultItem) => boolean;
  },
): Promise<VerifyStreamResult> {
  sink.send('progress', { stage: 'availability', pct: 60 });
  await svc.refreshPublicData(2500); // usually instant; at most once per 12 h per server it fetches fresh data
  const book = sendPricing(sink, svc);
  const keep = args.keep ?? (() => true);
  const verified = await runVerify({
    pairs: args.names.pairs,
    coreTerms: args.names.coreTerms,
    flagsOn: args.names.flagsOn,
    geo: args.profile.geo.value,
    siteType: args.profile.siteType.value,
    sensitive: args.profile.sensitive.includes('adult'),
    includeFree: args.includeFree,
    allowHyphens: args.allowHyphens,
    checker: svc.checker,
    freeChecker: svc.freeChecker,
    prices: book,
    deadline: Date.now() + availability.searchDeadlineMs,
    commonWord: isWord,
    onBatch: (results) => {
      const shown = results.filter(keep);
      if (shown.length) sink.send('batch', { results: shown });
    },
    onUpdate: (u) => sink.send('update', u),
  });
  if (verified.paused)
    sink.send('notice', {
      code: 'avl_paused',
      message: 'Availability checks are paused until 00:00 UTC; some names show as unconfirmed.',
    });
  const results = verified.results.filter(keep);
  const kept = new Set(results.map((r) => r.fqdn));
  const sections = Object.fromEntries(
    SECTIONS.map((s) => [s, verified.sections[s].filter((f) => kept.has(f))]),
  ) as Record<Section, string[]>;
  return {
    stored: { results, sections },
    counts: countBySection(sections),
    dataAgeHours: Math.round(priceAgeHours(book) * 10) / 10,
    stats: verified.stats,
  };
}
