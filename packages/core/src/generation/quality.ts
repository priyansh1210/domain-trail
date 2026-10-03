// Name quality Q (spec 004 tech §5.6, FR-GEN-008) and keyword coverage K.
import { commonness, isWord, meanLogProb } from './lexicon';

/** 0–1: trigram plausibility mapped from mean log-probability (≈ −2.5 for real words, ≈ −5 for random letters). */
export function pronounceability(label: string): number {
  const parts = label.split(/[^a-z]+/).filter(Boolean);
  if (parts.length === 0) return 0;
  const letters = parts.reduce((a, p) => a + p.length, 0);
  const mean = parts.reduce((a, p) => a + meanLogProb(p) * p.length, 0) / letters;
  return Math.max(0, Math.min(1, (mean + 4.5) / 2));
}

/**
 * Splits letters into dictionary words with as few pieces as possible, preferring common words. Returns null when
 * no split into known words exists (e.g. invented brandable names).
 */
export function segment(letters: string): string[] | null {
  const n = letters.length;
  const best: Array<{ pieces: number; score: number; prev: number } | null> = Array.from(
    { length: n + 1 },
    () => null,
  );
  best[0] = { pieces: 0, score: 0, prev: -1 };
  for (let end = 1; end <= n; end++) {
    for (let start = Math.max(0, end - 14); start < end; start++) {
      const word = letters.slice(start, end);
      const from = best[start];
      if (!from || word.length < 2 || !isWord(word)) continue;
      const cand = {
        pieces: from.pieces + 1,
        score: from.score + commonness(word) + word.length * 0.05,
        prev: start,
      };
      const cur = best[end];
      if (!cur || cand.pieces < cur.pieces || (cand.pieces === cur.pieces && cand.score > cur.score))
        best[end] = cand;
    }
  }
  if (!best[n]) return null;
  const out: string[] = [];
  for (let end = n; end > 0; end = best[end]!.prev) out.unshift(letters.slice(best[end]!.prev, end));
  return out;
}

export interface Shape {
  segments: string[];
  realWords: number;
  hasDigit: boolean;
  hasHyphen: boolean;
}

export function shape(label: string): Shape {
  const parts = label.split(/[-0-9]+/).filter(Boolean);
  const segments: string[] = [];
  let realWords = 0;
  for (const p of parts) {
    const s = segment(p);
    if (s) {
      segments.push(...s);
      realWords += s.length;
    } else segments.push(p);
  }
  return { segments, realWords, hasDigit: /\d/.test(label), hasHyphen: label.includes('-') };
}

function lengthScore(n: number): number {
  if (n >= 5 && n <= 10) return 1;
  if (n < 5) return Math.max(0, (n - 3) / 2);
  return Math.max(0, (18 - n) / 8);
}

/** Spelling clarity: penalise forms people mishear or mistype. */
function spellClarity(label: string, segments: string[]): number {
  let penalty = 0;
  if (/ph/.test(label)) penalty += 0.1;
  if (/(^|[^a-z])(u|4|2)([^a-z]|$)/.test(label) || /\d(u|4|2)/.test(label)) penalty += 0.3; // textisms
  if (/(.)\1/.test(label.replace(/(ll|ss|ee|oo|tt|ff|pp|rr|mm|nn|dd|cc)/g, ''))) penalty += 0.1;
  for (let i = 1; i < segments.length; i++) {
    if (segments[i - 1]!.slice(-1) === segments[i]![0]) penalty += 0.25; // "shopperspoint" style joins
  }
  if (/[qxz]{2}|[^aeiouy-]{5}/.test(label)) penalty += 0.3;
  return Math.max(0, 1 - penalty);
}

export function qualityOf(label: string, s: Shape = shape(label)): number {
  const pron = pronounceability(label);
  const letters = label.replace(/[^a-z]/g, '');
  const unknown = s.segments.filter((seg) => !isWord(seg)).length;
  const segmentation =
    unknown === 0 && s.realWords <= 2
      ? 1
      : unknown === 0 && s.realWords === 3
        ? 0.7
        : s.realWords === 0 && pron >= 0.7
          ? 0.4
          : 0.2;
  const clean = Math.max(0, 1 - 0.5 * Number(s.hasHyphen) - 0.5 * Number(s.hasDigit));
  const weighted =
    0.3 * lengthScore(letters.length || label.length) +
    0.3 * pron +
    0.2 * segmentation +
    0.1 * spellClarity(label, s.segments) +
    0.1 * clean;
  // Unpronounceable strings must not pass on length and clean characters alone (tech 004 §5.6 note).
  return weighted * Math.min(1, 0.4 + pron);
}

/** Share of the core terms' weight found in the name (capped at 1). */
export function keywordCoverage(label: string, s: Shape, weights: ReadonlyMap<string, number>): number {
  let k = 0;
  for (const [term, w] of weights) {
    if (s.segments.includes(term) || (term.length >= 4 && label.includes(term))) k += w;
  }
  return Math.min(1, k);
}
