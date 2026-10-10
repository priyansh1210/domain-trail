// Brand look-alike check (spec 014 tech §5.2; FR-ABU-006, 007, 008). Runs on every candidate before ranking.
import { BRANDS, WEAK_BRANDS } from './brands';

export const SECURITY_TERMS = new Set([
  'login',
  'signin',
  'logon',
  'secure',
  'security',
  'verify',
  'verification',
  'account',
  'accounts',
  'support',
  'wallet',
  'pay',
  'payment',
  'payments',
  'bank',
  'banking',
  'update',
  'auth',
  'password',
  'recovery',
  'help',
  'billing',
  'official',
  'refund',
  'unlock',
  'reset',
  'customer',
  'service',
  'care',
]);

const LEET: Record<string, string> = { '0': 'o', '1': 'l', '3': 'e', '4': 'a', '5': 's', '7': 't', '8': 'b' };

/** The label as a reader might see it: digits read as letters, look-alike pairs merged, separators removed. */
export function variants(label: string): string[] {
  const base = label
    .toLowerCase()
    .replace(/[0-9]/g, (d) => LEET[d] ?? d)
    .replace(/-/g, '');
  const out = new Set([base]);
  out.add(base.replace(/rn/g, 'm').replace(/vv/g, 'w').replace(/cl/g, 'd'));
  out.add(base.replace(/rn/g, 'm'));
  out.add(base.replace(/vv/g, 'w'));
  return [...out];
}

/** Damerau–Levenshtein distance with an early exit above `max`. */
export function editDistance(a: string, b: string, max = 2): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [
    i,
    ...Array<number>(b.length).fill(0),
  ]);
  for (let j = 1; j <= b.length; j++) d[0]![j] = j;
  for (let i = 1; i <= a.length; i++) {
    let rowMin = Infinity;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1])
        v = Math.min(v, d[i - 2]![j - 2]! + 1);
      d[i]![j] = v;
      rowMin = Math.min(rowMin, v);
    }
    if (rowMin > max) return max + 1;
  }
  return d[a.length]![b.length]!;
}

/** True when a and b are at most one edit apart (substitution, insertion, deletion or adjacent swap). O(n). */
export function withinOneEdit(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  if (a.length === b.length) {
    if (a.slice(i + 1) === b.slice(i + 1)) return true; // one substitution
    return a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2); // adjacent swap
  }
  return a.length > b.length ? a.slice(i + 1) === b.slice(i) : a.slice(i) === b.slice(i + 1); // insertion/deletion
}

interface BrandIndex {
  typo: Map<string, string[]>; // brands of 6+ letters under themselves and every one-letter deletion
  strictTypo: string[]; // brands of 8+ letters for the two-edit rule in strict mode
  strong: Set<string>; // not ordinary words: exact, contains, typo rules apply
  weak: Set<string>; // ordinary words too: only strict mode or next to security words
  all: Set<string>;
  curated: Set<string>; // the curated seed only (description brand tokens)
}

const LONG_SECURITY_TERMS = [...SECURITY_TERMS].filter((s) => s.length >= 5);

/** Popular site names from the weekly list (spec 010 §5.4); only the best-ranked ones get the typo rules. */
const POPULAR_TYPO_TOP = 10_000;

function buildIndex(extra: readonly string[]): BrandIndex {
  const curated = [...new Set(BRANDS.map((b) => b.toLowerCase()))];
  const popular = extra.map((b) => b.toLowerCase()).filter((b) => !WEAK_BRANDS.has(b));
  const curatedStrong = curated.filter((b) => !WEAK_BRANDS.has(b));
  const typoList = [...new Set([...curatedStrong, ...popular.slice(0, POPULAR_TYPO_TOP)])];
  const typo = new Map<string, string[]>();
  for (const b of typoList) {
    if (b.length < 6) continue;
    for (const key of new Set([b, ...deletions(b)])) typo.set(key, [...(typo.get(key) ?? []), b]);
  }
  return {
    typo,
    strictTypo: typoList.filter((b) => b.length >= 8),
    strong: new Set([...curatedStrong, ...popular]),
    weak: new Set(curated.filter((b) => WEAK_BRANDS.has(b))),
    all: new Set([...curated, ...popular]),
    curated: new Set(curated),
  };
}

/** Every string made by deleting one letter: two words one edit apart share one of these (or each other). */
function deletions(w: string): string[] {
  return Array.from({ length: w.length }, (_, i) => w.slice(0, i) + w.slice(i + 1));
}

let index: BrandIndex | undefined;
const extraIndexes = new WeakMap<readonly string[], BrandIndex>();
let popularBrands: readonly string[] = [];

function brandIndex(extra?: readonly string[]): BrandIndex {
  if (extra && extra.length > 0) {
    let built = extraIndexes.get(extra);
    if (!built) extraIndexes.set(extra, (built = buildIndex([...popularBrands, ...extra])));
    return built;
  }
  return (index ??= buildIndex(popularBrands));
}

/**
 * Adds the weekly popular-site names (best rank first) to every later check in this process. The server calls it
 * after loading `brand_labels`; without it only the curated seed applies (spec 014 §8 "brand list missing").
 */
export function setPopularBrands(labels: readonly string[]): void {
  popularBrands = labels;
  index = undefined;
}

/** Longest part of `v` (at least `minLen` letters) found in `set`, optionally skipping some words. */
function containedIn(
  v: string,
  set: ReadonlySet<string>,
  minLen: number,
  skip?: ReadonlySet<string>,
): string | undefined {
  for (let len = v.length; len >= minLen; len--)
    for (let i = 0; i + len <= v.length; i++) {
      const part = v.slice(i, i + len);
      if (set.has(part) && !skip?.has(part)) return part;
    }
  return undefined;
}

export interface BrandRiskOptions {
  strict?: boolean; // description asked to imitate a brand (safety_impersonation ≥ 0.70)
  descBrandTokens?: string[]; // brand words found in the description: banned outright
  segments?: string[]; // dictionary split of the label, if already known
  extraBrands?: readonly string[]; // more brand labels for this check only
}

export function brandRisk(
  label: string,
  opts: BrandRiskOptions = {},
): { risky: boolean; rule?: string; brand?: string } {
  const idx = brandIndex(opts.extraBrands);
  const segments = opts.segments ?? [];
  for (const token of opts.descBrandTokens ?? []) {
    if (token.length >= 3 && variants(label).some((v) => v.includes(token)))
      return { risky: true, rule: 'description_brand', brand: token };
  }
  const hasSecurityWord =
    segments.some((s) => SECURITY_TERMS.has(s)) || LONG_SECURITY_TERMS.some((s) => label.includes(s));
  // Brands one typo away share the word itself or one of its one-letter deletions as a key.
  const oneTypo = (s: string) => {
    for (const key of [s, ...deletions(s)])
      for (const b of idx.typo.get(key) ?? []) if (withinOneEdit(s, b)) return b;
    return undefined;
  };

  for (const v of variants(label)) {
    if (idx.strong.has(v) || (opts.strict && idx.weak.has(v)))
      return { risky: true, rule: 'exact', brand: v };
    const typo = oneTypo(v);
    if (typo) return { risky: true, rule: 'typo', brand: typo };
    for (const seg of segments) {
      const near = seg.length >= 5 ? oneTypo(seg) : undefined;
      if (near) return { risky: true, rule: 'typo', brand: near };
    }
    const contained = containedIn(v, idx.strong, 5);
    if (contained) return { risky: true, rule: 'contains', brand: contained };
    if (opts.strict) {
      const short = containedIn(v, idx.strong, 4);
      if (short) return { risky: true, rule: 'contains_strict', brand: short };
      for (const b of idx.strictTypo)
        if (editDistance(v, b, 2) <= 2) return { risky: true, rule: 'typo_strict', brand: b };
    }
    if (hasSecurityWord) {
      const combo = containedIn(v, idx.all, 4, SECURITY_TERMS);
      if (combo) return { risky: true, rule: 'combo', brand: combo };
    }
    if (opts.strict) {
      const weak = containedIn(v, idx.weak, 4);
      if (weak) return { risky: true, rule: 'contains_strict', brand: weak };
    }
  }
  return { risky: false };
}

/** Brand words a description mentions ("like Amazon but for books"), to keep them out of names. */
export function brandTokensIn(description: string): string[] {
  const idx = brandIndex();
  const words = description.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  return [
    ...new Set(
      words.filter(
        (w) =>
          idx.curated.has(w) &&
          (!idx.weak.has(w) || /[A-Z]/.test(description.match(new RegExp(`\\b${w}\\b`, 'i'))?.[0] ?? '')),
      ),
    ),
  ];
}
