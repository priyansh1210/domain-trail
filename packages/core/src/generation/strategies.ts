// Stage S3: candidate names from 12 naming styles (spec 004 tech §5.4; FR-GEN-004, 005, 012, 013, 016).
// Every random choice uses the seeded generator, so the same search gives the same candidates (FR-GEN-014).
import { isWord, nextLetterWeights } from './lexicon';
import { pronounceability } from './quality';
import { type Rng, sample } from './rng';

export type Strategy =
  | 'exact'
  | 'compound'
  | 'affix'
  | 'blend'
  | 'short'
  | 'alliteration'
  | 'rhyme'
  | 'brandable'
  | 'hack'
  | 'geo'
  | 'action'
  | 'personal';

export interface RawCandidate {
  label: string;
  strategy: Strategy;
  sourceTerms: string[];
  hackTld?: string;
}

export interface GenWord {
  word: string; // lower-case letters only
  weight: number; // core-term weight, or a share of it for expansions and hints
  core: boolean;
}

export interface GenInput {
  words: GenWord[]; // core terms, kept expansions and hints, best first
  phrases: string[]; // two-word core phrases, joined later
  geoWords: string[];
  actionVerbs: string[];
  personalNames: string[];
  hackTlds: string[]; // single-label extensions that may complete a word
  maxLength: number;
  trendAffixes?: { prefixes?: string[]; suffixes?: string[] }; // FR-GEN-016: popular now in new registrations
}

export const STRATEGY_CAPS: Record<Strategy, number> = {
  exact: 30,
  compound: 500,
  affix: 300,
  blend: 200,
  short: 100,
  alliteration: 100,
  rhyme: 50,
  brandable: 300,
  hack: 50,
  geo: 150,
  action: 150,
  personal: 50,
};

const PREFIXES = ['get', 'try', 'my', 'the', 'go', 'hey', 'join', 'use', 'hello'];
const SUFFIXES = [
  'hq',
  'hub',
  'lab',
  'labs',
  'co',
  'ly',
  'ify',
  'io',
  'app',
  'now',
  'club',
  'house',
  'works',
  'studio',
];
const ROLE_WORDS = ['studio', 'design', 'writes', 'works', 'makes', 'creates'];
const VOWELS = /[aeiouy]/;

/** "Bakery" + "ly" → "bakerly"; "cake" + "ify" → "cakify". */
function attachSuffix(word: string, suffix: string): string {
  if ((suffix === 'ly' || suffix === 'ify') && word.endsWith('y')) return word.slice(0, -1) + suffix;
  if (suffix === 'ify' && word.endsWith('e')) return word.slice(0, -1) + suffix;
  return word + suffix;
}

function blend(a: string, b: string): string | null {
  for (let k = Math.min(a.length, b.length) - 1; k >= 2; k--) {
    if (a.endsWith(b.slice(0, k))) return a + b.slice(k); // overlap: bread + delight → breadelight? needs "de" overlap
  }
  const lastVowel = a.search(/[aeiouy][^aeiouy]*$/);
  const firstVowel = b.search(VOWELS);
  if (lastVowel > 1 && firstVowel > 0) return a.slice(0, lastVowel + 1) + b.slice(firstVowel + 1);
  return null;
}

/** First syllable(s): consonants + vowel group + the next consonant ("sourdough" → "sour", "bakery" → "bak"). */
function clip(word: string): string[] {
  const m = /^[^aeiouy]*[aeiouy]+[^aeiouy]?/.exec(word);
  const out: string[] = [];
  if (m && m[0].length >= 3 && m[0].length < word.length) out.push(m[0]);
  const two = /^[^aeiouy]*[aeiouy]+[^aeiouy]+[aeiouy]+[^aeiouy]?/.exec(word);
  if (two && two[0].length >= 4 && two[0].length < word.length) out.push(two[0]);
  // vowel drop before a final y/r ("bakery" → "bakry")
  const dropped = word.replace(/e(r|ry|y)$/, '$1');
  if (dropped !== word && dropped.length >= 4) out.push(dropped);
  return out;
}

const SOUND: Record<string, string> = { c: 'k', k: 'k', q: 'k', f: 'f', s: 's', z: 's' };
const firstSound = (w: string) => (w.startsWith('ph') ? 'f' : (SOUND[w[0]!] ?? w[0]!));

/** Pseudo-word from the trigram model, started from a core term's first letters (spec: Markov, pron ≥ 0.6). */
function brandableWord(seed: string, rng: Rng, maxLen: number): string | null {
  let w = seed.slice(0, 2);
  const target = 5 + Math.floor(rng() * 3); // 5–7 letters
  while (w.length < Math.min(target, maxLen)) {
    const weights = nextLetterWeights(w.length >= 2 ? w[w.length - 2]! : '^', w[w.length - 1]!);
    const end = weights[26]!;
    const letters = weights.slice(0, 26);
    const total = letters.reduce((a, b) => a + b, 0) + (w.length >= 4 ? end : 0);
    if (total === 0) return null;
    let r = rng() * total;
    let next = -1;
    for (let i = 0; i < 26; i++) {
      r -= letters[i]!;
      if (r <= 0) {
        next = i;
        break;
      }
    }
    if (next < 0) break; // chose to end the word
    w += String.fromCharCode(97 + next);
  }
  if (w.length < 4 || isWord(w) || pronounceability(w) < 0.6) return null;
  return w;
}

export function generateCandidates(
  input: GenInput,
  rng: Rng,
  capsFactor: Partial<Record<Strategy, number>> = {},
): RawCandidate[] {
  const out: RawCandidate[] = [];
  const cap = (s: Strategy) => Math.round(STRATEGY_CAPS[s] * (capsFactor[s] ?? 1));
  const fits = (label: string) => label.length >= 3 && label.length <= Math.max(input.maxLength, 3);
  const push = (list: RawCandidate[], s: Strategy) =>
    out.push(...list.filter((c) => fits(c.label)).slice(0, cap(s)));
  const core = input.words.filter((w) => w.core).slice(0, 8);
  const pool = input.words.slice(0, 56);
  const byWeight = (a: { score: number }, b: { score: number }) => b.score - a.score;

  // exact: core words and joined two-word core phrases
  push(
    [
      ...core.map((w) => ({ label: w.word, strategy: 'exact' as const, sourceTerms: [w.word] })),
      ...input.phrases.map((p) => ({
        label: p.replace(/ /g, ''),
        strategy: 'exact' as const,
        sourceTerms: p.split(' '),
      })),
    ],
    'exact',
  );

  // compound: ordered pairs, scored by weight (at least one core or strong word), jittered by the seed
  const pairs: Array<RawCandidate & { score: number }> = [];
  for (const a of pool)
    for (const b of pool) {
      if (a.word === b.word || (!a.core && !b.core)) continue;
      pairs.push({
        label: a.word + b.word,
        strategy: 'compound',
        sourceTerms: [a.word, b.word],
        score: a.weight + b.weight + rng() * 0.05,
      });
    }
  push(pairs.filter((c) => fits(c.label)).sort(byWeight), 'compound');

  // affix: prefixes + core, core + suffixes (trending affixes first, FR-GEN-016)
  const prefixes = [...new Set([...(input.trendAffixes?.prefixes ?? []), ...PREFIXES])];
  const suffixes = [...new Set([...(input.trendAffixes?.suffixes ?? []), ...SUFFIXES])];
  const affixed: RawCandidate[] = [];
  for (const w of core) {
    for (const p of prefixes) affixed.push({ label: p + w.word, strategy: 'affix', sourceTerms: [w.word] });
    for (const s of suffixes)
      affixed.push({ label: attachSuffix(w.word, s), strategy: 'affix', sourceTerms: [w.word] });
  }
  push(sample(affixed, affixed.length, rng), 'affix');

  // blend: portmanteaus of two strong words
  const blends: RawCandidate[] = [];
  for (const a of pool.slice(0, 24))
    for (const b of pool.slice(0, 24)) {
      if (a.word === b.word || a.word.length < 4 || b.word.length < 4) continue;
      const label = blend(a.word, b.word);
      if (label && label !== a.word + b.word && label.length >= 5)
        blends.push({ label, strategy: 'blend', sourceTerms: [a.word, b.word] });
    }
  push(sample(blends, blends.length, rng), 'blend');

  // short: clipped forms, alone and with a short ending
  const shorts: RawCandidate[] = [];
  for (const w of core)
    for (const c of clip(w.word))
      for (const label of [c, `${c}ly`, `${c}r`, `${c}o`])
        shorts.push({ label, strategy: 'short', sourceTerms: [w.word] });
  push(shorts, 'short');

  // alliteration: two words with the same first sound
  const allit: RawCandidate[] = [];
  for (const a of pool)
    for (const b of pool)
      if (a.word !== b.word && (a.core || b.core) && firstSound(a.word) === firstSound(b.word))
        allit.push({ label: a.word + b.word, strategy: 'alliteration', sourceTerms: [a.word, b.word] });
  push(sample(allit, allit.length, rng), 'alliteration');

  // rhyme: a short word sharing the core term's ending, then the core term ("dough" → "goldough" style)
  const rhymes: RawCandidate[] = [];
  for (const w of core.slice(0, 2)) {
    const rime = w.word.slice(-3);
    for (const other of pool)
      if (other.word !== w.word && other.word.endsWith(rime))
        rhymes.push({ label: other.word + w.word, strategy: 'rhyme', sourceTerms: [other.word, w.word] });
  }
  push(rhymes, 'rhyme');

  // brandable: pseudo-words seeded from the core terms
  const brandables: RawCandidate[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < cap('brandable') * 4 && brandables.length < cap('brandable'); i++) {
    const seedWord = core[i % Math.max(core.length, 1)]?.word ?? 'ze';
    const label = brandableWord(seedWord, rng, input.maxLength);
    if (label && !seen.has(label)) {
      seen.add(label);
      brandables.push({ label, strategy: 'brandable', sourceTerms: [seedWord] });
    }
  }
  push(brandables, 'brandable');

  // hack: label + extension spell a word ("cak" + ".es" → cakes); only known extensions (FR-GEN-013)
  const hacks: RawCandidate[] = [];
  for (const w of pool)
    for (const tld of input.hackTlds)
      if (w.word.length - tld.length >= 2 && w.word.endsWith(tld))
        hacks.push({
          label: w.word.slice(0, -tld.length),
          strategy: 'hack',
          sourceTerms: [w.word],
          hackTld: tld,
        });
  push(hacks, 'hack');

  // geo: place + term, term + place (FR-GEN-012)
  const geo: RawCandidate[] = [];
  for (const g of input.geoWords)
    for (const w of core)
      geo.push(
        { label: g + w.word, strategy: 'geo', sourceTerms: [g, w.word] },
        { label: w.word + g, strategy: 'geo', sourceTerms: [w.word, g] },
      );
  push(geo, 'geo');

  // action: verb + term
  const actions: RawCandidate[] = [];
  for (const v of input.actionVerbs)
    for (const w of core) actions.push({ label: v + w.word, strategy: 'action', sourceTerms: [v, w.word] });
  push(actions, 'action');

  // personal: a person's name + term or role word
  const personal: RawCandidate[] = [];
  for (const n of input.personalNames)
    for (const x of [...core.slice(0, 4).map((w) => w.word), ...ROLE_WORDS])
      personal.push({ label: n + x, strategy: 'personal', sourceTerms: [n, x] });
  push(personal, 'personal');

  return out;
}
