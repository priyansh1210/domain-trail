// Stages S7–S9 (spec 000 tech §4; spec 005, 006, 007, 008 §5.4–5.6): check the best name + extension pairs, price
// them, score them with the price term and availability penalties, and fill the sections with variety rules.
// Results stream in batches as checks finish (FR-AVL-006); the final order per section comes at the end.
import type { Checker, CheckResult, CheckStatus } from '@domains-all/availability';
import { availability, ranking } from '@domains-all/config/defaults';
import { within } from '@domains-all/config/net';
import { findFreeNames, type FreeChecker, type FreeResult, selectProviders } from '@domains-all/free-domains';
import { type PriceBook, priceFor, TIER_BOUNDS, type Tier } from '@domains-all/pricing';
import { fairOrder, finalScore, type Pair, reasonsFor } from '../ranking/score';
import { type ResultItem, type Section, SECTIONS } from '../results';

export { type ResultItem, type Section, SECTIONS };

export const AVAILABILITY_PENALTY: Partial<Record<CheckStatus, number>> = {
  likely_available: 0.1,
  unknown: 0.2,
};
const RESTRICTED_PENALTY = 0.05;
const RENEW_WARNING_PENALTY = 0.05;
const PAGE = ranking.resultsPerSection;

/** P: price value within its section (spec 008 tech §5.4). */
export function priceValue(tier: Tier, upfrontUsdCents: number): number {
  if (tier === 'free') return 1;
  if (tier === 'premium') return 1 / (1 + Math.log10(upfrontUsdCents / TIER_BOUNDS.mid[1]!));
  const [min, max] = TIER_BOUNDS[tier] as readonly [number, number];
  return Math.max(0, Math.min(1, 1 - (upfrontUsdCents - min) / (max - min)));
}

export interface VerifyContext {
  pairs: readonly Pair[];
  coreTerms: ReadonlyMap<string, number>;
  flagsOn: readonly string[];
  geo: string;
  siteType: string;
  /** Adult or similar: no free providers (spec 007 §5.2). */
  sensitive: boolean;
  includeFree: boolean;
  allowHyphens: boolean;
  checker: Checker;
  freeChecker: FreeChecker;
  prices: PriceBook;
  deadline: number;
  /** Is the label a common word (premium prices more likely, FR-PRC-012)? */
  commonWord?: (label: string) => boolean;
  onBatch?: (items: ResultItem[]) => void;
  /** A re-check changed a shown result (status taken → the page removes it). */
  onUpdate?: (u: { fqdn: string; status: CheckStatus; checkedAt: string }) => void;
  now?: () => number;
}

export interface VerifyOutcome {
  results: ResultItem[];
  /** Final order per section after the variety rules (spec 008 §5.5). */
  sections: Record<Section, string[]>;
  paused: boolean;
  stats: { checked: number; registrable: number; free: number; cached: number; unknown: number };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

function scoredItem(pair: Pair, check: CheckResult, ctx: VerifyContext): ResultItem {
  const priced = priceFor(
    { label: pair.label, tld: pair.tld, status: check.status, commonWord: ctx.commonWord?.(pair.label) },
    ctx.prices,
  );
  const section: Section = priced.priced ? priced.tier : 'unpriced';
  const P = priced.priced ? priceValue(priced.tier, priced.upfrontUsdCents) : 0;
  const penalty =
    (AVAILABILITY_PENALTY[check.status] ?? 0) +
    (priced.restriction ? RESTRICTED_PENALTY : 0) +
    (priced.priced && priced.renewWarning ? RENEW_WARNING_PENALTY : 0);
  const reasons = reasonsFor(pair, { coreTerms: ctx.coreTerms, flagsOn: ctx.flagsOn, geo: ctx.geo });
  if (priced.priced && P >= 0.8 && reasons.length < 3) reasons.push({ id: 'value', vars: {} });
  const item: ResultItem = {
    fqdn: pair.fqdn,
    label: pair.label,
    tld: pair.tld,
    section,
    status: check.status,
    checkedAt: check.checkedAt,
    score: Math.round((finalScore(pair, P) - penalty) * 1000) / 1000,
    signals: {
      R: round2(pair.ranked.R),
      Q: round2(pair.ranked.quality),
      T: round2(pair.T),
      K: round2(pair.ranked.keywordCoverage),
      P: round2(P),
    },
    reasons,
    strategy: pair.ranked.strategy,
    source: pair.ranked.source,
    ...(priced.restriction ? { restriction: priced.restriction } : {}),
    ...(priced.requiresHttps ? { requiresHttps: true } : {}),
  };
  if (priced.priced) {
    const { priced: _p, tier: _t, restriction: _r, requiresHttps: _h, ...price } = priced;
    item.price = price;
  }
  return item;
}

/**
 * Variety (FR-RANK-008, 009): ≤ 3 per name per section; no style above 40 % of the first page. Unconfirmed names
 * (FR-AVL-008) only fill the first page when there are too few confirmed ones — a page of "Unconfirmed" helps nobody.
 */
export function orderSection(items: readonly ResultItem[]): string[] {
  const sorted = [...items].sort((a, b) => b.score - a.score || a.fqdn.localeCompare(b.fqdn));
  const perLabel = new Map<string, number>();
  const perStyle = new Map<string, number>();
  const styleCap = Math.floor(ranking.maxStyleShare * PAGE);
  const first: string[] = [];
  const later: string[] = [];
  for (const it of sorted) {
    if ((perLabel.get(it.label) ?? 0) >= ranking.maxExtensionsPerNamePerSection) continue;
    perLabel.set(it.label, (perLabel.get(it.label) ?? 0) + 1);
    if (first.length < PAGE && (perStyle.get(it.strategy) ?? 0) < styleCap) {
      perStyle.set(it.strategy, (perStyle.get(it.strategy) ?? 0) + 1);
      first.push(it.fqdn);
    } else later.push(it.fqdn);
  }
  // Too few styles to fill the first page under the rule: top up in score order.
  while (first.length < PAGE && later.length) first.push(later.shift()!);
  const ordered = [...first, ...later];
  const unknown = new Set(items.filter((i) => i.status === 'unknown').map((i) => i.fqdn));
  let room = Math.max(0, PAGE - (ordered.length - ordered.filter((f) => unknown.has(f)).length));
  return ordered.filter((f) => !unknown.has(f) || room-- > 0);
}

function freeItem(r: FreeResult, pairByLabel: ReadonlyMap<string, Pair>): ResultItem {
  const pair = pairByLabel.get(r.label);
  return {
    fqdn: r.fqdn,
    label: r.label,
    tld: r.fqdn.slice(r.label.length + 1),
    section: 'free',
    status: r.status,
    checkedAt: r.checkedAt,
    free: { providerId: r.providerId, providerName: r.providerName, kind: r.kind, conditions: r.conditions },
    score: Math.round(r.score * 1000) / 1000,
    reasons: [],
    strategy: pair?.ranked.strategy ?? 'exact',
    source: pair?.ranked.source ?? 'deterministic',
  };
}

/** Labels for free providers: the best ranked names plus "<word>-site"/"<word>-app" for hosting addresses. */
export function freeLabels(
  pairs: readonly Pair[],
  coreTerms: ReadonlyMap<string, number>,
  allowHyphens: boolean,
) {
  const best = new Map<string, number>();
  for (const p of pairs) best.set(p.label, Math.max(best.get(p.label) ?? 0, finalScore(p)));
  const top = [...best.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20);
  const max = top[0]?.[1] ?? 1;
  const labels = top.map(([label, s]) => ({ label, relevance: Math.max(0, s / max) }));
  const word = [...coreTerms.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  if (word && allowHyphens)
    labels.push({ label: `${word}-site`, relevance: 0.5 }, { label: `${word}-app`, relevance: 0.45 });
  return labels.filter((l) => allowHyphens || !l.label.includes('-'));
}

export async function runVerify(ctx: VerifyContext): Promise<VerifyOutcome> {
  const now = ctx.now ?? Date.now;
  // Which pairs to check: every extension's best names, in turn, so checks spread across registries.
  const ordered = fairOrder(ctx.pairs, (p) => finalScore(p)).slice(0, availability.maxFqdnsPerSearch);
  const pairByFqdn = new Map(ordered.map((p) => [p.fqdn, p]));
  const pairByLabel = new Map<string, Pair>();
  for (const p of ordered) if (!pairByLabel.has(p.label)) pairByLabel.set(p.label, p);

  const results = new Map<string, ResultItem>();
  let buffer: ResultItem[] = [];
  const flush = () => {
    if (buffer.length) ctx.onBatch?.(buffer);
    buffer = [];
  };
  const add = (item: ResultItem) => {
    results.set(item.fqdn, item);
    buffer.push(item);
    if (buffer.length >= 10) flush();
  };

  const freeTask = (async () => {
    if (!ctx.includeFree) return [];
    const providers = selectProviders({
      siteType: ctx.siteType,
      flagsOn: ctx.flagsOn,
      sensitive: ctx.sensitive,
    });
    if (!providers.length) return [];
    const found = await findFreeNames({
      labels: freeLabels(ordered, ctx.coreTerms, ctx.allowHyphens),
      providers,
      checker: ctx.freeChecker,
      now,
    }).catch(() => []);
    return found.map((r) => freeItem(r, pairByLabel));
  })();

  const { stats, results: checks } = await ctx.checker.checkMany(
    ordered.map((p) => p.fqdn),
    {
      deadline: ctx.deadline,
      reverify: new Set(ordered.slice(0, PAGE).map((p) => p.fqdn)),
      onResult: (r) => {
        const pair = pairByFqdn.get(r.fqdn);
        if (!pair || r.status === 'taken' || r.status === 'dropping_soon') return; // dropping soon: phase 2
        add(scoredItem(pair, r, ctx));
      },
      onUpdate: (r) => {
        if (r.status === 'taken' || r.status === 'dropping_soon') results.delete(r.fqdn);
        ctx.onUpdate?.({ fqdn: r.fqdn, status: r.status, checkedAt: r.checkedAt });
      },
    },
  );
  flush();
  // Free names may not hold up the results: they get until a little after the availability deadline.
  const free = await within(freeTask, Math.max(1000, ctx.deadline + 3000 - now()), [] as ResultItem[]);
  for (const item of free) results.set(item.fqdn, item);
  if (free.length) ctx.onBatch?.(free);

  const all = [...results.values()];
  const sections = Object.fromEntries(
    SECTIONS.map((s) => [
      s,
      s === 'free' ? free.map((f) => f.fqdn) : orderSection(all.filter((r) => r.section === s)),
    ]),
  ) as Record<Section, string[]>;
  return {
    results: all,
    sections,
    paused: stats.paused,
    stats: {
      checked: checks.length,
      registrable: all.length - free.length,
      free: free.length,
      cached: stats.cached,
      unknown: stats.byStatus.unknown ?? 0,
    },
  };
}
