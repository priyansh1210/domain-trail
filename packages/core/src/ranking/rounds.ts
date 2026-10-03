// Ranking rounds S5 and S6 (spec 008 tech §5.1–5.2; FR-RANK-001…004, 011, 014, 016).
import { stageDeadlinesMs } from '@domains-all/config';
import {
  rankFit,
  rankShard,
  riskBrand,
  riskNegative,
  tldFit,
  type AnswerMemo,
  type AskQuestion,
  type DecisionService,
} from '@domains-all/jev';
import type { Candidate } from '../generation/prefilter';
import { FLAG_TLDS } from './tlds';
import { tldOptions } from './tld-pool';

export const ROUND2_SIZE = 45;
export const BRAND_MAX = 0.5; // RANK_BRAND_MAX
export const NEGATIVE_MAX = 0.6; // RANK_NEGATIVE_MAX
const SHARD = 250;
const PER_SHARD = 15;

export interface Ranked extends Candidate {
  lift?: number; // round 1: probability × shard size (> 1 = better than average)
  R: number; // relevance 0..1
  brand?: number;
  negative?: number;
  source: 'jev' | 'deterministic';
}

export interface RoundResult<T> {
  items: T;
  usage: { tokens: number; requests: number };
  degraded: boolean;
}

/** Deterministic estimate used when Jev cannot answer (FR-RANK-014). */
export const deterministicR = (c: Candidate) => 0.6 * c.keywordCoverage + 0.4 * c.quality;
const detOrder = (a: Candidate, b: Candidate) =>
  deterministicR(b) - deterministicR(a) || a.label.localeCompare(b.label);

/** S5: Jev compares candidates in groups of up to 250 and the best ~45 go on (FR-RANK-001). */
export async function rankRound1(
  candidates: readonly Candidate[],
  ctx: { jev: DecisionService; state: unknown; searchId: string; memo?: AnswerMemo; now?: () => number },
): Promise<RoundResult<Candidate[]> & { lift: Map<string, number> }> {
  const sorted = [...candidates].sort(
    (a, b) =>
      0.5 * (b.quality + b.keywordCoverage) - 0.5 * (a.quality + a.keywordCoverage) ||
      a.label.localeCompare(b.label),
  );
  const shards: Candidate[][] = [];
  for (let i = 0; i < Math.min(sorted.length, 4 * SHARD); i += SHARD) shards.push(sorted.slice(i, i + SHARD));
  const lift = new Map<string, number>();
  if (shards.length === 0) return { items: [], usage: { tokens: 0, requests: 0 }, degraded: false, lift };

  const questions: AskQuestion[] = shards
    .filter((s) => s.length >= 2)
    .map((shard, i) => ({
      name: `rank_shard__${i}`,
      def: rankShard,
      criteriaOverride: Object.fromEntries(shard.map((c, j) => [`o${String(j).padStart(3, '0')}`, c.label])),
    }));
  const now = ctx.now ?? Date.now;
  const res = questions.length
    ? await ctx.jev.ask({
        state: ctx.state,
        questions,
        deadline: now() + stageDeadlinesMs.S5,
        searchId: ctx.searchId,
        stage: 'S5',
        memo: ctx.memo,
      })
    : null;

  const picked = new Set<string>();
  shards.forEach((shard, i) => {
    const a = res?.answers[`rank_shard__${i}`];
    if (a?.type !== 'choice') return;
    shard.forEach((c, j) =>
      lift.set(c.label, (a.probabilities[`o${String(j).padStart(3, '0')}`] ?? 0) * shard.length),
    );
    [...shard]
      .sort((x, y) => (lift.get(y.label) ?? 0) - (lift.get(x.label) ?? 0))
      .slice(0, PER_SHARD)
      .forEach((c) => picked.add(c.label));
  });

  const det = [...sorted].sort(detOrder);
  if (picked.size === 0) {
    // fallback: deterministic top 45
    return {
      items: det.slice(0, ROUND2_SIZE),
      usage: res
        ? { tokens: res.usage.inputTokens, requests: res.usage.requests }
        : { tokens: 0, requests: 0 },
      degraded: true,
      lift,
    };
  }
  for (const c of det) {
    if (picked.size >= 60) break;
    picked.add(c.label);
  }
  // Trim to 45 by the average of the lift rank and the deterministic rank, both measured within the ~60 picked, so a
  // name Jev clearly prefers is not lost to a deterministic rank among hundreds of others.
  const liftRank = new Map(
    [...picked].sort((a, b) => (lift.get(b) ?? 0) - (lift.get(a) ?? 0)).map((l, i) => [l, i]),
  );
  const detRank = new Map(det.filter((c) => picked.has(c.label)).map((c, i) => [c.label, i]));
  const items = sorted
    .filter((c) => picked.has(c.label))
    .sort(
      (a, b) =>
        liftRank.get(a.label)! + detRank.get(a.label)! - (liftRank.get(b.label)! + detRank.get(b.label)!) ||
        a.label.localeCompare(b.label),
    )
    .slice(0, ROUND2_SIZE);
  return {
    items,
    usage: { tokens: res!.usage.inputTokens, requests: res!.usage.requests },
    degraded: res!.degraded,
    lift,
  };
}

/** S6: fit ratings, brand / negative-meaning checks, and extension fit (FR-RANK-002…004, 011, 016). */
export async function rankRound2(
  top: readonly Candidate[],
  ctx: {
    jev: DecisionService;
    state: unknown;
    pool: readonly string[];
    preferredTlds: readonly string[];
    flagsOn: readonly string[];
    searchId: string;
    memo?: AnswerMemo;
    now?: () => number;
  },
): Promise<RoundResult<Ranked[]> & { tldFit: Map<string, number>; excluded: number }> {
  const now = ctx.now ?? Date.now;
  const deadline = now() + stageDeadlinesMs.S6;
  const fitQs: AskQuestion[] = top.map((c, n) => ({
    name: `rank_fit__${n}`,
    def: rankFit,
    vars: { label: c.label },
  }));
  const { criteria, keyToTld } = tldOptions(ctx.pool);
  if (Object.keys(criteria).length >= 2)
    fitQs.push({ name: 'tld_fit', def: tldFit, criteriaOverride: criteria });
  // Brand / negative checks depend only on the label: a fixed state lets the memo reuse them after chip edits (§5.7).
  const riskQs: AskQuestion[] = top.flatMap((c, n) => [
    { name: `risk_brand__${n}`, def: riskBrand, vars: { label: c.label } },
    { name: `risk_negative__${n}`, def: riskNegative, vars: { label: c.label } },
  ]);
  const [fit, risk] = await Promise.all([
    ctx.jev.ask({
      state: ctx.state,
      questions: fitQs,
      deadline,
      searchId: ctx.searchId,
      stage: 'S6',
      memo: ctx.memo,
    }),
    ctx.jev.ask({
      state: 'Domain name candidates',
      questions: riskQs,
      deadline,
      searchId: ctx.searchId,
      stage: 'S6',
      memo: ctx.memo,
    }),
  ]);

  let excluded = 0;
  const items: Ranked[] = [];
  top.forEach((c, n) => {
    const f = fit.answers[`rank_fit__${n}`];
    const b = risk.answers[`risk_brand__${n}`];
    const g = risk.answers[`risk_negative__${n}`];
    const brand = b?.type === 'noul' ? b.noul : undefined;
    const negative = g?.type === 'noul' ? g.noul : undefined;
    if ((brand ?? 0) >= BRAND_MAX || (negative ?? 0) >= NEGATIVE_MAX) {
      excluded++; // FR-RANK-003
      return;
    }
    const R =
      f?.type === 'score' ? f.confidence * (f.score / 4) + (1 - f.confidence) * 0.5 : deterministicR(c); // shrink to the middle
    items.push({ ...c, R, brand, negative, source: f?.type === 'score' ? 'jev' : 'deterministic' });
  });

  // Extension fit T: Jev's probabilities scaled to the best one; rule order when Jev did not answer.
  const tldFitMap = new Map<string, number>();
  const t = fit.answers.tld_fit;
  if (t?.type === 'choice') {
    const max = Math.max(...Object.values(t.probabilities), 1e-9);
    for (const [key, p] of Object.entries(t.probabilities)) {
      const tld = keyToTld.get(key);
      if (tld) tldFitMap.set(tld, p / max);
    }
  } else {
    const ordered = [...new Set(ctx.flagsOn.flatMap((f) => FLAG_TLDS[f] ?? []))];
    ordered.forEach((tld, i) => tldFitMap.set(tld, Math.max(0.3, 1 - i * 0.1)));
    for (const tld of ctx.pool) if (!tldFitMap.has(tld)) tldFitMap.set(tld, 0.3);
  }
  tldFitMap.set('com', Math.max(tldFitMap.get('com') ?? 0, 0.6));
  for (const p of ctx.preferredTlds) tldFitMap.set(p, Math.max(tldFitMap.get(p) ?? 0, 0.9)); // FR-RANK-011

  return {
    items,
    tldFit: tldFitMap,
    excluded,
    usage: {
      tokens: fit.usage.inputTokens + risk.usage.inputTokens,
      requests: fit.usage.requests + risk.usage.requests,
    },
    degraded: fit.degraded || risk.degraded,
  };
}
