// Stage S4: keep only valid, safe, good-quality and varied candidates (spec 004 tech §5.5; FR-GEN-006…011, 015).
import { PROFANITY } from './lexicon';
import { keywordCoverage, qualityOf, shape, type Shape } from './quality';
import type { RawCandidate, Strategy } from './strategies';
import { brandRisk } from '../safety/brand-risk';

export interface Candidate extends RawCandidate {
  quality: number; // Q
  keywordCoverage: number; // K
  flags: Shape;
}

export interface PrefilterOptions {
  maxLength: number;
  allowHyphens: boolean;
  allowDigits: boolean;
  weights: ReadonlyMap<string, number>; // core term → weight, for K
  strictBrand?: boolean;
  descBrandTokens?: string[];
  exclude?: ReadonlySet<string>; // labels already shown in this search (FR-GEN-015)
  qualityMin?: number; // QUALITY_MIN
  maxCandidates?: number; // MAX_CANDIDATES
  maxStyleShare?: number; // STRATEGY_MAX_SHARE
}

const LDH = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const LEET: Record<string, string> = {
  '0': 'o',
  '1': 'i',
  '3': 'e',
  '4': 'a',
  '5': 's',
  '7': 't',
  '@': 'a',
  $: 's',
};
const LONG_PROFANITY = PROFANITY.filter((p) => p.length >= 5);
const SHORT_PROFANITY = new Set(PROFANITY.filter((p) => p.length < 5));

/** Long offensive words anywhere (also spelled with digits); short ones only as a whole word, so "classic" is fine. */
export function isProfane(label: string, segments: readonly string[]): boolean {
  const plain = label.replace(/-/g, '');
  const read = plain.replace(/[0-9@$]/g, (c) => LEET[c] ?? c);
  if (LONG_PROFANITY.some((p) => plain.includes(p) || read.includes(p))) return true;
  return segments.some((s) => SHORT_PROFANITY.has(s));
}

/** Singular/plural and -er/-ers forms of one idea share a key ("breadhub" / "breadhubs"). */
function dedupKey(segments: readonly string[]): string {
  return segments
    .map((s) => (s.length > 3 ? s.replace(/ies$/, 'y').replace(/(?<!s)(es|s)$/, '') : s))
    .join('');
}

export function prefilter(raw: readonly RawCandidate[], opts: PrefilterOptions): Candidate[] {
  const qualityMin = opts.qualityMin ?? 0.35;
  const exclude = opts.exclude ?? new Set<string>();
  const seen = new Map<string, Candidate>();

  for (const r of raw) {
    const label = r.label.toLowerCase();
    if (!LDH.test(label)) continue; // FR-GEN-006
    if (label.length > opts.maxLength) continue; // FR-GEN-007
    if (!opts.allowHyphens && label.includes('-')) continue;
    if (label.includes('--')) continue; // positions 3–4 are reserved for IDN; ugly elsewhere
    if (!opts.allowDigits && /\d/.test(label)) continue;
    if (/(.)\1\1/.test(label)) continue; // triple letters
    if (exclude.has(label)) continue; // FR-GEN-015

    const s = shape(label);
    if (isProfane(label, s.segments)) continue; // FR-GEN-009
    if (
      brandRisk(label, {
        strict: opts.strictBrand,
        descBrandTokens: opts.descBrandTokens,
        segments: s.segments,
      }).risky
    )
      continue;

    const quality = qualityOf(label, s);
    if (quality < qualityMin) continue; // FR-GEN-008
    const c: Candidate = {
      ...r,
      label,
      quality,
      keywordCoverage: keywordCoverage(label, s, opts.weights),
      flags: s,
    };

    const key = dedupKey(s.segments); // FR-GEN-010
    const cur = seen.get(key);
    if (!cur || c.quality > cur.quality) seen.set(key, c);
  }
  return diversify([...seen.values()], opts.maxCandidates ?? 1000, opts.maxStyleShare ?? 0.4);
}

/** Best first by 0.5·Q + 0.5·K, at most `max`, and no style above `share` of the result (FR-GEN-011). */
export function diversify(cands: Candidate[], max: number, share: number): Candidate[] {
  const ranked = [...cands].sort(
    (a, b) =>
      0.5 * (b.quality + b.keywordCoverage) - 0.5 * (a.quality + a.keywordCoverage) ||
      a.label.localeCompare(b.label),
  );
  let target = Math.min(max, ranked.length);
  // With fewer than 3 styles no set can keep every style at or below 40 %, so the share rule only applies from 3 up.
  if (new Set(ranked.map((c) => c.strategy)).size < 3) return ranked.slice(0, target);
  for (;;) {
    const cap = Math.max(1, Math.floor(share * target));
    const counts = new Map<Strategy, number>();
    const picked: Candidate[] = [];
    for (const c of ranked) {
      if (picked.length >= target) break;
      const n = counts.get(c.strategy) ?? 0;
      if (n >= cap) continue;
      counts.set(c.strategy, n + 1);
      picked.push(c);
    }
    // When few styles exist the cap can leave the set short; shrink the target until the rule holds exactly.
    if (picked.length === target || target <= 1) return picked;
    target = picked.length;
  }
}
