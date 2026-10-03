// Offline ranking evaluation (spec 016 tech §5.1, FR-QA-005, NFR-RANK-001/004): the owner's good and bad names for
// each golden example are mixed into the generated candidates, the pipeline ranks everything, and NDCG@10 measures
// how well good names come before bad ones (good = 1, bad = 0).
import type { DecisionService } from '@domains-all/jev';
import { buildState } from '@domains-all/jev';
import { generate } from '../generation/generate';
import type { Candidate } from '../generation/prefilter';
import { keywordCoverage, qualityOf, shape } from '../generation/quality';
import { keepExpansions, relatedWords } from '../generation/related';
import type { RawCandidate } from '../generation/strategies';
import { extractTerms, weighTerms } from '../generation/terms';
import { PreferencesSchema } from '../intake/schema';
import { deterministicR, rankRound1, rankRound2 } from '../ranking/rounds';
import { finalScore, pair } from '../ranking/score';
import { buildTldPool } from '../ranking/tld-pool';
import { runS1 } from '../pipeline/s1';

export interface GoldenItem {
  id: string;
  category: string;
  description: string;
  goodNames?: string[];
  badNames?: string[];
  expected: Record<string, unknown>;
}

export function ndcgAt(relevances: readonly number[], k = 10): number {
  const dcg = (rels: readonly number[]) =>
    rels.slice(0, k).reduce((acc, r, i) => acc + r / Math.log2(i + 2), 0);
  const ideal = dcg([...relevances].sort((a, b) => b - a));
  return ideal === 0 ? 0 : dcg(relevances) / ideal;
}

export interface ItemResult {
  id: string;
  ndcg: number;
  order: Array<{ label: string; good: boolean }>;
  outcome: string;
}

/** Ranks the item's labelled names among the generated candidates and returns NDCG@10 over the labelled ones. */
export async function evaluateItem(item: GoldenItem, jev: DecisionService): Promise<ItemResult> {
  const preferences = PreferencesSchema.parse({
    maxLength: 20,
    allowHyphens: true,
    allowDigits: true,
    forceSearch: true,
  });
  const s1 = await runS1({ description: item.description, preferences, searchId: `eval-${item.id}`, jev });
  if (s1.kind !== 'features') return { id: item.id, ndcg: 0, order: [], outcome: s1.kind };
  const profile = s1.profile;

  const terms = weighTerms(extractTerms(item.description, profile));
  const { expansions } = await relatedWords(terms, { live: false });
  const gen = generate({
    description: item.description,
    profile,
    preferences,
    terms,
    expansions: keepExpansions(expansions),
    seed: item.id,
    strictBrand: false,
    descBrandTokens: [],
  });

  const good = new Set(item.goodNames ?? []);
  const labelled = [...good, ...(item.badNames ?? [])];
  const injected: Candidate[] = labelled.map((label) => {
    const raw: RawCandidate = { label, strategy: 'exact', sourceTerms: [label] };
    const s = shape(label);
    return {
      ...raw,
      quality: qualityOf(label, s),
      keywordCoverage: keywordCoverage(label, s, gen.weights),
      flags: s,
    };
  });
  const pool = [...injected, ...gen.candidates.filter((c) => !labelled.includes(c.label))];

  const flagsOn = Object.entries(profile.flags)
    .filter(([, f]) => f.on)
    .map(([k]) => k);
  const state = buildState('S5', {
    description: item.description,
    summary: {
      siteType: profile.siteType.value,
      industry: profile.industry.value,
      audience: profile.audience.value,
      geo: profile.geo.value,
      tone: String(profile.tone.level),
      features: flagsOn,
    },
    keywords: terms.filter((t) => t.core).map((t) => t.text),
  });
  // Labelled names always reach round 2 so every one of them gets a rating; the rest compete as usual.
  const r1 = await rankRound1(pool, { jev, state, searchId: `eval-${item.id}` });
  const finalists = [...injected, ...r1.items.filter((c) => !labelled.includes(c.label))].slice(
    0,
    45 + injected.length,
  );
  const r2 = await rankRound2(finalists, {
    jev,
    state,
    pool: buildTldPool(profile, preferences),
    preferredTlds: [],
    flagsOn,
    searchId: `eval-${item.id}`,
  });

  const score = new Map<string, number>();
  for (const p of pair(r2.items, r2.tldFit, { preferredTlds: [] }))
    score.set(p.label, Math.max(score.get(p.label) ?? -1, finalScore(p)));
  // Names excluded in round 2 (brand / negative meaning) rank last.
  const order = labelled
    .map((label) => ({
      label,
      good: good.has(label),
      s: score.get(label) ?? -1 + deterministicR(injected.find((c) => c.label === label)!) / 10,
    }))
    .sort((a, b) => b.s - a.s || a.label.localeCompare(b.label));
  return {
    id: item.id,
    ndcg: ndcgAt(order.map((o) => (o.good ? 1 : 0))),
    order: order.map(({ label, good: g }) => ({ label, good: g })),
    outcome: 'ranked',
  };
}

export async function evaluateGolden(items: readonly GoldenItem[], jev: DecisionService) {
  const results: ItemResult[] = [];
  for (const item of items.filter((i) => i.category === 'benign' && (i.goodNames?.length ?? 0) > 0)) {
    results.push(await evaluateItem(item, jev));
  }
  const mean = results.reduce((a, r) => a + r.ndcg, 0) / Math.max(1, results.length);
  return { results, meanNdcg: mean };
}
