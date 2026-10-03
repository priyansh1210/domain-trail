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
  byLength: Map<number, string[]>; // strong brands of 6+ letters by length, for the one-typo rule
  strong: string[]; // not ordinary words: exact, contains, typo rules apply
  weak: Set<string>; // ordinary words too: only strict mode or next to security words
  all: Set<string>;
}

const LONG_SECURITY_TERMS = [...SECURITY_TERMS].filter((s) => s.length >= 5);

let index: BrandIndex | undefined;
function brandIndex(extra: readonly string[] = []): BrandIndex {
  if (index && extra.length === 0) return index;
  const list = [...new Set([...BRANDS, ...extra].map((b) => b.toLowerCase()))];
  const strongList = list.filter((b) => !WEAK_BRANDS.has(b));
  const byLength = new Map<number, string[]>();
  for (const b of strongList)
    if (b.length >= 6) byLength.set(b.length, [...(byLength.get(b.length) ?? []), b]);
  const built: BrandIndex = {
    byLength,
    strong: strongList,
    weak: new Set(list.filter((b) => WEAK_BRANDS.has(b))),
    all: new Set(list),
  };
  if (extra.length === 0) index = built;
  return built;
}

export interface BrandRiskOptions {
  strict?: boolean; // description asked to imitate a brand (safety_impersonation ≥ 0.70)
  descBrandTokens?: string[]; // brand words found in the description: banned outright
  segments?: string[]; // dictionary split of the label, if already known
  extraBrands?: readonly string[]; // e.g. the weekly popular-site list
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
  // Only brands within one letter of the same length can be one typo away.
  const nearby = (s: string) =>
    [s.length - 1, s.length, s.length + 1].flatMap((n) => idx.byLength.get(n) ?? []);

  for (const v of variants(label)) {
    if (idx.strong.includes(v) || (opts.strict && idx.weak.has(v)))
      return { risky: true, rule: 'exact', brand: v };
    for (const b of nearby(v)) if (withinOneEdit(v, b)) return { risky: true, rule: 'typo', brand: b };
    for (const seg of segments) {
      if (seg.length >= 5)
        for (const b of nearby(seg))
          if (withinOneEdit(seg, b)) return { risky: true, rule: 'typo', brand: b };
    }
    for (const b of idx.strong) {
      if (b.length >= 5 && v.includes(b)) return { risky: true, rule: 'contains', brand: b };
      if (opts.strict) {
        if (b.length >= 4 && v.includes(b)) return { risky: true, rule: 'contains_strict', brand: b };
        if (b.length >= 8 && editDistance(v, b, 2) <= 2)
          return { risky: true, rule: 'typo_strict', brand: b };
      }
    }
    if (hasSecurityWord) {
      for (const b of idx.all) {
        if (b.length >= 4 && v.includes(b) && !SECURITY_TERMS.has(b))
          return { risky: true, rule: 'combo', brand: b };
      }
    }
    if (opts.strict) {
      for (const b of idx.weak)
        if (b.length >= 4 && v.includes(b)) return { risky: true, rule: 'contains_strict', brand: b };
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
          idx.all.has(w) &&
          (!idx.weak.has(w) || /[A-Z]/.test(description.match(new RegExp(`\\b${w}\\b`, 'i'))?.[0] ?? '')),
      ),
    ),
  ];
}
