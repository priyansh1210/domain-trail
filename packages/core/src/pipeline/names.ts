// Pipeline stages S2–S6: key terms → related words → candidates → two ranking rounds → name ideas with extensions
// (spec 000 tech §4, spec 004, spec 008). Availability and prices (S7–S8) arrive in milestone M4.
import { stageDeadlinesMs } from '@domains-all/config';
import {
  buildState,
  expansionFit,
  keywordCore,
  type AnswerMemo,
  type DecisionService,
  type DegradedReason,
} from '@domains-all/jev';
import type { SiteProfile } from '../features/types';
import { generate } from '../generation/generate';
import { expansionOptions, keepExpansions, relatedWords, type WordCache } from '../generation/related';
import { extractTerms, keywordOptions, weighTerms } from '../generation/terms';
import type { Preferences } from '../intake/schema';
import { rankRound1, rankRound2 } from '../ranking/rounds';
import { pair, toIdeas, type Idea, type Pair } from '../ranking/score';
import { buildTldPool } from '../ranking/tld-pool';
import { GEO_TLDS } from '../ranking/tlds';
import { brandTokensIn } from '../safety/brand-risk';
import type { StageUsage } from './s1';

export interface NamesContext {
  description: string;
  preferences: Preferences;
  profile: SiteProfile;
  strictBrand: boolean;
  searchId: string;
  seed: string; // result-cache key → reproducible names (FR-GEN-014)
  jev: DecisionService;
  live: boolean; // false in mock mode: no Datamuse calls
  fetchFn?: typeof fetch;
  wordCache?: WordCache;
  memo?: AnswerMemo;
  exclude?: ReadonlySet<string>;
  /** "Find more in this range": picks extensions from the pool whose price is in the chosen band (FR-PRC-009). */
  bandTlds?: (pool: readonly string[]) => string[];
  now?: () => number;
}

export interface NamesOutcome {
  ideas: Idea[];
  /** Ranked name + extension pairs for availability checks (S7). */
  pairs: Pair[];
  coreTerms: ReadonlyMap<string, number>;
  flagsOn: string[];
  lowSupply: boolean;
  usage: StageUsage;
  degraded?: DegradedReason;
  stats: {
    terms: number;
    expansions: number;
    raw: number;
    candidates: number;
    ranked: number;
    excluded: number;
    datamuseCalls: number;
  };
}

const TONE_WORDS = ['very playful', 'friendly', 'neutral', 'professional', 'very formal'];

export async function runNames(ctx: NamesContext): Promise<NamesOutcome> {
  const now = ctx.now ?? Date.now;
  const usage: StageUsage = { tokens: 0, requests: 0 };
  let degraded: DegradedReason | undefined;
  const track = (r: {
    usage: { inputTokens: number; requests: number };
    degraded: boolean;
    degradedReason?: DegradedReason;
  }) => {
    usage.tokens += r.usage.inputTokens;
    usage.requests += r.usage.requests;
    if (r.degraded) degraded = degraded === 'budget' ? 'budget' : (r.degradedReason ?? 'jev_unavailable');
  };

  // S2: key terms (local), Jev weights them while related words are fetched in parallel.
  const terms = extractTerms(ctx.description, ctx.profile);
  const s2State = buildState('S2', {
    description: ctx.description,
    preferences: { country: ctx.preferences.country, preferredTlds: ctx.preferences.preferredTlds },
  });
  const s2Deadline = now() + stageDeadlinesMs.S2;
  const [kw, related] = await Promise.all([
    terms.length >= 2
      ? ctx.jev.ask({
          state: s2State,
          questions: [{ name: 'keyword_core', def: keywordCore, criteriaOverride: keywordOptions(terms) }],
          deadline: s2Deadline,
          searchId: ctx.searchId,
          stage: 'S2',
          memo: ctx.memo,
        })
      : null,
    relatedWords(weighTerms(terms), { live: ctx.live, fetchFn: ctx.fetchFn, cache: ctx.wordCache }),
  ]);
  if (kw) track(kw);
  const weighted = weighTerms(terms, kw?.answers.keyword_core);

  let expansions = related.expansions;
  if (expansions.length >= 2) {
    const fit = await ctx.jev.ask({
      state: s2State,
      questions: [
        { name: 'expansion_fit', def: expansionFit, criteriaOverride: expansionOptions(expansions) },
      ],
      deadline: Math.max(s2Deadline, now() + 1000),
      searchId: ctx.searchId,
      stage: 'S2',
      memo: ctx.memo,
    });
    track(fit);
    const a = fit.answers.expansion_fit;
    expansions = keepExpansions(expansions, a?.type === 'choice' ? a.probabilities : undefined);
  } else expansions = keepExpansions(expansions);

  // S3–S4: candidates in 12 styles, filtered.
  const gen = generate({
    description: ctx.description,
    profile: ctx.profile,
    preferences: ctx.preferences,
    terms: weighted,
    expansions,
    seed: ctx.seed,
    strictBrand: ctx.strictBrand,
    descBrandTokens: brandTokensIn(ctx.description),
    exclude: ctx.exclude,
  });

  // S5–S6: Jev ranking.
  const flagsOn = Object.entries(ctx.profile.flags)
    .filter(([, f]) => f.on)
    .map(([k]) => k);
  const rankState = buildState('S5', {
    description: ctx.description,
    summary: {
      siteType: ctx.profile.siteType.value,
      industry: ctx.profile.industry.value,
      audience: ctx.profile.audience.value,
      geo: ctx.profile.geo.value,
      tone: TONE_WORDS[ctx.profile.tone.level] ?? 'neutral',
      features: flagsOn,
    },
    keywords: weighted.filter((t) => t.core).map((t) => t.text),
  });
  const r1 = await rankRound1(gen.candidates, {
    jev: ctx.jev,
    state: rankState,
    searchId: ctx.searchId,
    memo: ctx.memo,
    now,
  });
  usage.tokens += r1.usage.tokens;
  usage.requests += r1.usage.requests;
  if (r1.degraded) degraded ??= 'jev_unavailable';

  const pool = buildTldPool(ctx.profile, ctx.preferences);
  const r2 = await rankRound2(r1.items, {
    jev: ctx.jev,
    state: rankState,
    pool,
    preferredTlds: ctx.preferences.preferredTlds,
    flagsOn,
    searchId: ctx.searchId,
    memo: ctx.memo,
    now,
  });
  usage.tokens += r2.usage.tokens;
  usage.requests += r2.usage.requests;
  if (r2.degraded) degraded ??= 'jev_unavailable';

  const pairs = pair(r2.items, r2.tldFit, {
    preferredTlds: ctx.preferences.preferredTlds,
    bandTlds: ctx.bandTlds?.(pool),
    anchors: ['com', ...(GEO_TLDS[ctx.profile.geo.value] ?? []).slice(0, 1)],
  });
  const ideas = toIdeas(pairs, { coreTerms: gen.weights, flagsOn, geo: ctx.profile.geo.value });

  return {
    ideas,
    pairs,
    coreTerms: gen.weights,
    flagsOn,
    lowSupply: gen.lowSupply,
    usage,
    ...(degraded ? { degraded } : {}),
    stats: {
      terms: terms.length,
      expansions: expansions.length,
      raw: gen.rawCount,
      candidates: gen.candidates.length,
      ranked: r2.items.length,
      excluded: r2.excluded,
      datamuseCalls: related.calls,
    },
  };
}
