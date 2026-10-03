// Stages S3 + S4: build the generator input from key terms, related words and the site profile, generate candidates
// in 12 styles, filter them, and relax when too few survive (spec 004 tech §5.4–5.5, §8).
import type { SiteProfile } from '../features/types';
import type { Preferences } from '../intake/schema';
import { type Candidate, prefilter } from './prefilter';
import type { Expansion } from './related';
import { seededRng } from './rng';
import { type GenInput, type GenWord, generateCandidates } from './strategies';
import { placesIn, type WeightedTerm } from './terms';

/** Verbs that suit a kind of site, for the `action` style ("ordersourdough"). */
const ACTION_VERBS: Record<string, string[]> = {
  online_store: ['shop', 'buy', 'order'],
  restaurant_cafe: ['order', 'taste', 'eat'],
  booking_service: ['book', 'reserve'],
  education_courses: ['learn', 'study'],
  community_forum: ['join', 'meet'],
  saas_web_app: ['try', 'use'],
  mobile_app: ['try', 'get'],
  nonprofit: ['give', 'help'],
  event: ['join', 'meet'],
  job_board: ['hire', 'find'],
  real_estate: ['find', 'rent'],
  marketplace: ['buy', 'sell'],
};
const FLAG_VERBS: Record<string, string[]> = {
  feat_bookings: ['book'],
  feat_courses: ['learn'],
  feat_community: ['join'],
  feat_sells_physical: ['shop', 'order'],
  feat_travel: ['explore', 'visit'],
  feat_fitness: ['move', 'train'],
  feat_donations: ['give'],
};

/** Single-label extensions that can complete a word ("cak.es"); M4 limits these to priced extensions. */
export const HACK_TLDS = [
  'es',
  'ly',
  'co',
  'io',
  'me',
  'it',
  'is',
  'at',
  'in',
  'us',
  'ai',
  'so',
  'sh',
  'to',
  'de',
  'ch',
  'cafe',
  'shop',
  'store',
  'art',
  'fit',
];

/** Capitalised words that are not places, brands or sentence starts: likely a person's or business name. */
export function personalNamesIn(description: string): string[] {
  const names = new Set<string>();
  for (const m of description.matchAll(/(?<![.!?]\s|^)\b([A-Z][a-z]{2,11})\b/g)) {
    const w = m[1]!.toLowerCase();
    if (!placesIn(m[1]!).length) names.add(w);
  }
  return [...names].slice(0, 3);
}

export interface GenerateContext {
  description: string;
  profile: SiteProfile;
  preferences: Pick<Preferences, 'maxLength' | 'allowHyphens' | 'allowDigits'>;
  terms: readonly WeightedTerm[];
  expansions: readonly Expansion[];
  seed: string; // the result-cache key, so the same search gives the same names
  strictBrand: boolean;
  descBrandTokens: string[];
  exclude?: ReadonlySet<string>;
  trendAffixes?: GenInput['trendAffixes'];
}

export interface GenerateResult {
  candidates: Candidate[];
  rawCount: number;
  lowSupply: boolean;
  weights: Map<string, number>;
}

const letters = (s: string) => s.replace(/[^a-z]/g, '');

export function buildGenInput(ctx: GenerateContext): GenInput {
  const words = new Map<string, GenWord>();
  const add = (word: string, weight: number, core: boolean) => {
    const w = letters(word);
    if (w.length < 2 || w.length > 14) return;
    const cur = words.get(w);
    if (!cur || cur.weight < weight) words.set(w, { word: w, weight, core: core || (cur?.core ?? false) });
  };
  const top = ctx.terms[0]?.w ?? 1;
  for (const t of ctx.terms) {
    if (t.kind === 'phrase' || t.kind === 'geo') continue;
    add(t.text, t.kind === 'hint' ? Math.max(t.w, 0.25 * top) : t.w, t.core && t.kind !== 'hint');
  }
  // Related words support the key terms; Datamuse/Jev-picked ones (live) count more than offline WordNet ones.
  for (const e of ctx.expansions) add(e.word, (e.source === 'datamuse' ? 0.5 : 0.3) * top * e.score, false);

  const flagsOn = Object.entries(ctx.profile.flags)
    .filter(([, f]) => f.on)
    .map(([k]) => k);
  const verbs = new Set([
    ...(ACTION_VERBS[ctx.profile.siteType.value] ?? []),
    ...flagsOn.flatMap((f) => FLAG_VERBS[f] ?? []),
  ]);
  const personal = flagsOn.includes('feat_personal') || flagsOn.includes('feat_portfolio');

  return {
    words: [...words.values()].sort((a, b) => b.weight - a.weight || a.word.localeCompare(b.word)),
    phrases: ctx.terms.filter((t) => t.kind === 'phrase' && t.core).map((t) => t.text),
    geoWords: ctx.terms.filter((t) => t.kind === 'geo').map((t) => letters(t.text)),
    actionVerbs: [...verbs],
    personalNames: personal ? personalNamesIn(ctx.description) : [],
    hackTlds: HACK_TLDS,
    maxLength: ctx.preferences.maxLength,
    trendAffixes: ctx.trendAffixes,
  };
}

export function generate(ctx: GenerateContext): GenerateResult {
  const input = buildGenInput(ctx);
  const weights = new Map(ctx.terms.filter((t) => t.core).map((t) => [letters(t.text), t.w]));
  const run = (relaxed: boolean) => {
    const raw = generateCandidates(
      input,
      seededRng(ctx.seed),
      relaxed ? { brandable: 2, affix: 2, short: 2 } : {},
    );
    const candidates = prefilter(raw, {
      ...ctx.preferences,
      weights,
      strictBrand: ctx.strictBrand,
      descBrandTokens: ctx.descBrandTokens,
      exclude: ctx.exclude,
      qualityMin: relaxed ? 0.25 : 0.35,
    });
    return { raw: raw.length, candidates };
  };
  const first = run(false);
  if (first.candidates.length >= 100)
    return { candidates: first.candidates, rawCount: first.raw, lowSupply: false, weights };
  const relaxed = run(true); // tech §8: < 100 candidates → bigger caps, lower quality bar, flag low supply
  return { candidates: relaxed.candidates, rawCount: relaxed.raw, lowSupply: true, weights };
}
