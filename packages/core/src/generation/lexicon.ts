// Offline word data (spec 004 tech §2): dictionary with commonness ranks, related words, a character trigram model
// for pronounceability and the brandable generator, and the profanity list. Built by scripts/build-words.mjs.
import profanityData from './data/profanity.json';
import relatedData from './data/related-words.json';
import trigramData from './data/trigrams.json';
import wordsData from './data/words.json';

const WORDS = wordsData as string[];
const RANK = new Map(WORDS.map((w, i) => [w, i]));
const RELATED = new Map(relatedData as Array<[string, string[]]>);

export const isWord = (w: string): boolean => RANK.has(w);

/** 1 for the most common words, falling towards 0 for rare ones; 0 when not a word. */
export function commonness(w: string): number {
  const r = RANK.get(w);
  return r === undefined ? 0 : 1 - Math.min(1, Math.log10(r + 10) / Math.log10(WORDS.length + 10));
}

export const relatedOffline = (w: string): readonly string[] => RELATED.get(w) ?? [];

export const PROFANITY: readonly string[] = profanityData as string[];

// ----- character trigram model (26 letters + boundary) -----
const COUNTS = trigramData as number[];
const CTX = new Float64Array(27 * 27);
for (let i = 0; i < COUNTS.length; i++) CTX[Math.floor(i / 27)]! += COUNTS[i]!;
const code = (ch: string) => (ch < 'a' || ch > 'z' ? 26 : ch.charCodeAt(0) - 97);

export function trigramLogProb(a: string, b: string, c: string): number {
  const ctx = code(a) * 27 + code(b);
  return Math.log((COUNTS[ctx * 27 + code(c)]! + 0.1) / (CTX[ctx]! + 2.7));
}

/** Mean log-probability per letter of a word-like string (letters only, boundaries added). */
export function meanLogProb(letters: string): number {
  const s = `^^${letters}$`;
  let sum = 0;
  for (let i = 2; i < s.length; i++) sum += trigramLogProb(s[i - 2]!, s[i - 1]!, s[i]!);
  return sum / (s.length - 2);
}

/** Next-letter distribution after two letters, for the brandable generator. */
export function nextLetterWeights(a: string, b: string): number[] {
  const ctx = (code(a) * 27 + code(b)) * 27;
  return Array.from({ length: 27 }, (_, i) => COUNTS[ctx + i]!);
}
