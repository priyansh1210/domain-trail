// Pairing, final score, reasons and the M3 "ideas" list (spec 008 tech §5.3, §5.4, §5.6; FR-RANK-005, 006, 007, 010).
import { FLAG_TLDS, GEO_TLDS } from './tlds';
import type { Ranked } from './rounds';

export interface Pair {
  label: string;
  tld: string;
  fqdn: string;
  ranked: Ranked;
  T: number;
}

export const MAX_FQDNS = 300; // RANK_MAX_FQDNS
export const WEIGHTS = { R: 0.45, Q: 0.2, T: 0.15, K: 0.1, P: 0.1 }; // RANK_WEIGHTS (P from M4, with prices)
export const PENALTIES = { hyphen: 0.05, digit: 0.05 };

/** Each name × its best-fitting extensions, the user's choices, its hack extension and band extensions. */
export function pair(
  ranked: readonly Ranked[],
  tldFit: ReadonlyMap<string, number>,
  opts: {
    preferredTlds: readonly string[];
    bandTlds?: readonly string[];
    perLabel?: number;
    /** Always offered alongside the best fits: ".com" and the local extension (spec 008 §5.3 note, 2026-10-04). */
    anchors?: readonly string[];
  },
): Pair[] {
  const best = [...tldFit.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, opts.perLabel ?? 6)
    .map(([t]) => t);
  const out: Pair[] = [];
  for (const r of ranked) {
    const tlds = new Set([
      ...best,
      ...(opts.anchors ?? []),
      ...opts.preferredTlds,
      ...(r.hackTld ? [r.hackTld] : []),
      ...(opts.bandTlds ?? []),
    ]);
    for (const tld of tlds) {
      const fqdn = `${r.label}.${tld}`;
      if (r.label.length > 63) continue;
      out.push({ label: r.label, tld, fqdn, ranked: r, T: r.hackTld === tld ? 1 : (tldFit.get(tld) ?? 0.3) });
    }
  }
  return fairOrder(out, (p) => p.ranked.R * p.T).slice(0, MAX_FQDNS);
}

/**
 * Best first within each extension, taking extensions in turn (strongest extension first). A cap then keeps every
 * extension's best names instead of filling up with one extension, and availability checks spread across
 * registries, each of which is limited to a few requests per second (spec 005 NFR-AVL-006; 2026-10-04).
 */
export function fairOrder(pairs: readonly Pair[], score: (p: Pair) => number): Pair[] {
  const groups = new Map<string, Array<{ p: Pair; s: number }>>();
  for (const p of pairs) groups.set(p.tld, [...(groups.get(p.tld) ?? []), { p, s: score(p) }]);
  const lists = [...groups.values()]
    .map((g) => g.sort((a, b) => b.s - a.s || a.p.fqdn.localeCompare(b.p.fqdn)))
    .sort((a, b) => b[0]!.s - a[0]!.s || a[0]!.p.tld.localeCompare(b[0]!.p.tld));
  const out: Pair[] = [];
  for (let i = 0; out.length < pairs.length; i++) for (const list of lists) if (list[i]) out.push(list[i]!.p);
  return out;
}

/** S = wR·R + wQ·Q + wT·T + wK·K (+ wP·P once prices exist) − penalties (FR-RANK-006, 007). */
export function finalScore(p: Pair, P?: number): number {
  const r = p.ranked;
  const penalties = (r.flags.hasHyphen ? PENALTIES.hyphen : 0) + (r.flags.hasDigit ? PENALTIES.digit : 0);
  return (
    WEIGHTS.R * r.R +
    WEIGHTS.Q * r.quality +
    WEIGHTS.T * p.T +
    WEIGHTS.K * r.keywordCoverage +
    (P === undefined ? 0 : WEIGHTS.P * P) -
    penalties
  );
}

export interface Reason {
  id:
    | 'keyword'
    | 'excellent_fit'
    | 'short'
    | 'tld_fit'
    | 'tld_trust'
    | 'local'
    | 'brandable'
    | 'hack'
    | 'value';
  vars: Record<string, string | number>;
}

/** 1–3 reasons whose triggers hold for this result (FR-RANK-010, NFR-RANK-003). Texts live in the UI messages. */
export function reasonsFor(
  p: Pair,
  ctx: { coreTerms: ReadonlyMap<string, number>; flagsOn: readonly string[]; geo: string },
): Reason[] {
  const r = p.ranked;
  const out: Reason[] = [];
  const term = [...ctx.coreTerms.keys()].find(
    (t) => r.flags.segments.includes(t) || (t.length >= 4 && r.label.includes(t)),
  );
  if (r.keywordCoverage >= 0.3 && term) out.push({ id: 'keyword', vars: { term } });
  if (r.source === 'jev' && r.R >= 0.85) out.push({ id: 'excellent_fit', vars: {} });
  if (r.label.length <= 8 && r.quality >= 0.7) out.push({ id: 'short', vars: { n: r.label.length } });
  if (r.strategy === 'hack' && r.hackTld === p.tld) out.push({ id: 'hack', vars: { tld: p.tld } });
  const flag = ctx.flagsOn.find((f) => (FLAG_TLDS[f] ?? []).includes(p.tld));
  if (p.T >= 0.7 && flag) out.push({ id: 'tld_fit', vars: { tld: p.tld, flag } });
  if ((GEO_TLDS[ctx.geo] ?? []).includes(p.tld))
    out.push({ id: 'local', vars: { tld: p.tld, geo: ctx.geo } });
  if (p.tld === 'com') out.push({ id: 'tld_trust', vars: {} });
  if (r.strategy === 'brandable' && r.quality >= 0.7) out.push({ id: 'brandable', vars: {} });
  return out.slice(0, 3);
}

/** M3 preview: names grouped with their best extensions. Not checked for availability (constitution P3). */
export interface Idea {
  label: string;
  strategy: string;
  score: number;
  tlds: Array<{ tld: string; fit: number }>;
  reasons: Reason[];
  source: 'jev' | 'deterministic';
}

export const MAX_PER_TERM = 3; // ideas built on the same key word
export const STYLE_SHARE = 0.4; // RANK_STYLE_MAX_SHARE, applied to the top 20 (FR-RANK-009)

export function toIdeas(pairs: readonly Pair[], ctx: Parameters<typeof reasonsFor>[1], limit = 30): Idea[] {
  const byLabel = new Map<string, Array<{ p: Pair; s: number }>>();
  for (const p of pairs) {
    const list = byLabel.get(p.label) ?? [];
    list.push({ p, s: finalScore(p) });
    byLabel.set(p.label, list);
  }
  const all = [...byLabel.values()]
    .map((list) => {
      const sorted = list.sort((a, b) => b.s - a.s || a.p.tld.localeCompare(b.p.tld));
      const top = sorted[0]!;
      const r = top.p.ranked;
      return {
        idea: {
          label: top.p.label,
          strategy: r.strategy,
          score: Math.round(top.s * 1000) / 1000,
          tlds: sorted.slice(0, 3).map((x) => ({ tld: x.p.tld, fit: Math.round(x.p.T * 100) / 100 })),
          reasons: reasonsFor(top.p, ctx),
          source: r.source,
        } satisfies Idea,
        // the key word the name is built on, for the variety rule
        term: r.sourceTerms.find((s) => ctx.coreTerms.has(s)) ?? r.sourceTerms[0] ?? r.label,
      };
    })
    .sort((a, b) => b.idea.score - a.idea.score || a.idea.label.localeCompare(b.idea.label));

  // Variety (FR-RANK-009): at most 3 ideas per key word, and no style above 40 % of the top 20.
  const picked: typeof all = [];
  const perTerm = new Map<string, number>();
  const perStyle = new Map<string, number>();
  const styleCap = Math.floor(STYLE_SHARE * 20);
  for (const x of all) {
    if (picked.length >= limit) break;
    if ((perTerm.get(x.term) ?? 0) >= MAX_PER_TERM) continue;
    if (picked.length < 20 && (perStyle.get(x.idea.strategy) ?? 0) >= styleCap) continue;
    perTerm.set(x.term, (perTerm.get(x.term) ?? 0) + 1);
    perStyle.set(x.idea.strategy, (perStyle.get(x.idea.strategy) ?? 0) + 1);
    picked.push(x);
  }
  // Too few distinct words or styles to fill the list under the rules: top up with the best of the rest.
  for (const x of all) {
    if (picked.length >= limit) break;
    if (!picked.includes(x)) picked.push(x);
  }
  return picked.map((x) => x.idea);
}
