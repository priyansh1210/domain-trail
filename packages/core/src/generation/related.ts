// Stage S2b: related words (spec 004 tech §5.3; FR-GEN-003, FR-GEN-018, NFR-GEN-002). Datamuse in live mode, with a
// 30-day cache; the offline WordNet data otherwise or when Datamuse is slow or down. Only single words are sent.
import { commonness, isWord, PROFANITY, relatedOffline } from './lexicon';
import { brandRisk } from '../safety/brand-risk';
import type { WeightedTerm } from './terms';

export interface Expansion {
  word: string;
  score: number; // higher = more related
  from: string; // the core term it came from
  source: 'datamuse' | 'wordnet';
}

export interface WordCache {
  get(term: string, relation: string): Promise<string[] | null>;
  set(term: string, relation: string, words: string[]): Promise<void>;
}

export class MemoryWordCache implements WordCache {
  private readonly map = new Map<string, string[]>();
  async get(term: string, relation: string) {
    return this.map.get(`${relation}:${term}`) ?? null;
  }
  async set(term: string, relation: string, words: string[]) {
    if (this.map.size > 5000) this.map.clear();
    this.map.set(`${relation}:${term}`, words);
  }
}

export interface RelatedOptions {
  live: boolean; // false in MOCK_EXTERNALS mode: no network
  fetchFn?: typeof fetch;
  cache?: WordCache;
  maxCalls?: number; // DATAMUSE_MAX_CALLS
  timeoutMs?: number; // DATAMUSE_TIMEOUT_MS
}

const RELATIONS: Array<[relation: string, param: string, max: number]> = [
  ['ml', 'ml', 40], // means like
  ['trg', 'rel_trg', 20], // often associated
  ['jjb', 'rel_jjb', 15], // adjectives used with the noun
];
const MAX_EXPANSIONS = 255;
/** About the 15,000 most common words (those seen in WordNet's tagged sample). */
const OFFLINE_MIN_COMMONNESS = 0.11;

function acceptable(word: string): boolean {
  return (
    /^[a-z]{2,12}$/.test(word) &&
    isWord(word) &&
    !PROFANITY.some((p) => p.length >= 4 && word.includes(p)) &&
    !brandRisk(word).risky
  );
}

async function datamuse(
  term: string,
  param: string,
  max: number,
  opts: RelatedOptions,
): Promise<string[] | null> {
  try {
    const url = `https://api.datamuse.com/words?${param}=${encodeURIComponent(term)}&max=${max}`;
    const res = await (opts.fetchFn ?? fetch)(url, { signal: AbortSignal.timeout(opts.timeoutMs ?? 1500) });
    if (!res.ok) return null;
    const json = (await res.json()) as Array<{ word?: unknown }>;
    return json.map((x) => String(x.word ?? '')).filter(Boolean);
  } catch {
    return null; // no retry: latency matters more (tech §8)
  }
}

export async function relatedWords(
  core: readonly WeightedTerm[],
  opts: RelatedOptions,
): Promise<{ expansions: Expansion[]; calls: number }> {
  const terms = core
    .filter((t) => t.core && !t.text.includes(' '))
    .slice(0, 5)
    .map((t) => t.text);
  const out = new Map<string, Expansion>();
  const add = (word: string, score: number, from: string, source: Expansion['source']) => {
    if (word === from || !acceptable(word)) return;
    const cur = out.get(word);
    if (!cur || cur.score < score) out.set(word, { word, score, from, source });
  };

  let calls = 0;
  const maxCalls = opts.maxCalls ?? 15;
  await Promise.all(
    terms.map(async (term) => {
      let gotOnline = false;
      if (opts.live) {
        for (const [relation, param, max] of RELATIONS) {
          let words = (await opts.cache?.get(term, relation)) ?? null;
          if (!words && calls < maxCalls) {
            calls++;
            words = await datamuse(term, param, max, opts);
            if (words) await opts.cache?.set(term, relation, words).catch(() => undefined);
          }
          if (words) {
            gotOnline = true;
            words.forEach((w, i) =>
              add(w, (relation === 'ml' ? 1 : 0.8) * (1 - i / (max * 1.5)), term, 'datamuse'),
            );
          }
        }
      }
      if (!gotOnline) {
        // FR-GEN-018: offline WordNet data, one hop plus the neighbours of the first few related words.
        // First-hand relations only, and only reasonably common words: WordNet also lists rare synonyms
        // ("menage") and second-hand relations drift off topic (developer → creator → god).
        relatedOffline(term)
          .filter((w) => commonness(w) >= OFFLINE_MIN_COMMONNESS)
          .forEach((w, i) => add(w, 0.9 - i * 0.03, term, 'wordnet'));
      }
    }),
  );

  const expansions = [...out.values()]
    .sort((a, b) => b.score - a.score || a.word.localeCompare(b.word))
    .slice(0, MAX_EXPANSIONS);
  return { expansions, calls };
}

/** Options for Jev's `expansion_fit@1`: w000…w254 → word. */
export function expansionOptions(expansions: readonly Expansion[]): Record<string, string> {
  return Object.fromEntries(expansions.map((e, i) => [`w${String(i).padStart(3, '0')}`, e.word]));
}

/** Keeps the 40 best expansions: by Jev's fit when it answered, else by relatedness. */
export function keepExpansions(
  expansions: readonly Expansion[],
  probabilities?: Record<string, number>,
  keep = 40,
): Expansion[] {
  if (!probabilities) return expansions.slice(0, keep);
  return expansions
    .map((e, i) => ({ e, p: probabilities[`w${String(i).padStart(3, '0')}`] ?? 0 }))
    .sort((a, b) => b.p - a.p || b.e.score - a.e.score)
    .slice(0, keep)
    .map((x) => x.e);
}
