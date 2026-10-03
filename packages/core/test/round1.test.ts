// Spec 008 tech §11 `round1.test.ts` (FR-RANK-001): sharding, lift, top 15 per shard, deterministic fallback.
import type { Answer } from '@domains-all/jev';
import { describe, expect, it } from 'vitest';
import type { Candidate } from '../src/generation/prefilter';
import { rankRound1, ROUND2_SIZE } from '../src/ranking/rounds';
import { failingJev, scriptedJev } from './support/profile';

const cand = (i: number): Candidate => ({
  label: `name${String(i).padStart(4, '0')}`,
  strategy: 'compound',
  sourceTerms: [],
  quality: 0.5 + (i % 7) / 100,
  keywordCoverage: (i % 5) / 10,
  flags: { segments: [], realWords: 0, hasDigit: false, hasHyphen: false },
});
const many = Array.from({ length: 600 }, (_, i) => cand(i));

describe('round 1', () => {
  it('asks one question per shard of up to 250 and keeps 45', async () => {
    // Jev strongly prefers the first option of every shard.
    const jev = scriptedJev((name, p) => {
      const q = p.questions.find((x) => x.name === name)!;
      const keys = Object.keys(q.criteriaOverride as Record<string, string>);
      const probabilities = Object.fromEntries(
        keys.map((k, i) => [k, i === 0 ? 0.5 : 0.5 / (keys.length - 1)]),
      );
      return { type: 'choice', choice: keys[0]!, probabilities, confidence: 0.5 } as Answer;
    });
    const r = await rankRound1(many, { jev, state: {}, searchId: 's' });
    const qs = jev.calls[0]!.questions;
    expect(qs.map((q) => q.name)).toEqual(['rank_shard__0', 'rank_shard__1', 'rank_shard__2']);
    expect(Object.keys(qs[0]!.criteriaOverride as object)).toHaveLength(250);
    expect(r.items).toHaveLength(ROUND2_SIZE);
    expect(r.degraded).toBe(false);
    // Each shard's favourite has lift = p × shard size > 1 and survives.
    const favourites = qs.map((q) => (q.criteriaOverride as Record<string, string>).o000!);
    for (const f of favourites) expect(r.items.map((c) => c.label)).toContain(f);
    expect(r.lift.get(favourites[0]!)).toBeCloseTo(125);
  });

  it('falls back to the deterministic top 45 when Jev fails (FR-RANK-014)', async () => {
    const r = await rankRound1(many, { jev: failingJev(), state: {}, searchId: 's' });
    expect(r.items).toHaveLength(ROUND2_SIZE);
    expect(r.degraded).toBe(true);
    const det = (c: Candidate) => 0.6 * c.keywordCoverage + 0.4 * c.quality;
    for (let i = 1; i < r.items.length; i++)
      expect(det(r.items[i - 1]!)).toBeGreaterThanOrEqual(det(r.items[i]!));
  });

  it('handles an empty candidate list', async () => {
    expect((await rankRound1([], { jev: failingJev(), state: {}, searchId: 's' })).items).toEqual([]);
  });
});
