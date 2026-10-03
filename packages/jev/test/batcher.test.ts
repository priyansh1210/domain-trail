// Spec 002 tech §11 `batcher.test.ts` (FR-JEV-012).
import { describe, expect, it } from 'vitest';
import { batchQuestions } from '../src/batcher';
import { flags, profile, safety } from '../src/catalog';
import type { WireQuestion } from '../src/types';
import { toWire } from '../src/wire';

const s1 = [...safety, ...profile.filter((q) => q.id !== 'industry'), ...flags].map(
  (def) => [def.id, toWire({ name: def.id, def })] as [string, WireQuestion],
);

describe('batchQuestions', () => {
  it('splits stage S1 into two balanced requests (catalog overview)', () => {
    const batches = batchQuestions({ description: 'x' }, s1);
    expect(batches).toHaveLength(2);
    expect(Math.abs(batches[0]!.length - batches[1]!.length)).toBeLessThanOrEqual(1);
    expect(
      batches
        .flat()
        .map(([n]) => n)
        .sort(),
    ).toEqual(s1.map(([n]) => n).sort());
  });

  it('respects the per-request question limit', () => {
    const many = Array.from(
      { length: 130 },
      (_, i) => [`q_${i}`, { type: 'noul', instructions: `statement ${i}` }] as [string, WireQuestion],
    );
    const batches = batchQuestions('state', many, {
      maxQuestions: 50,
      maxRequestTokens: 60_000,
      maxStatePlusQuestionTokens: 31_000,
    });
    expect(batches).toHaveLength(3);
    expect(Math.max(...batches.map((b) => b.length))).toBeLessThanOrEqual(50);
  });

  it('opens more requests when tokens, not counts, are the limit', () => {
    const big = Array.from(
      { length: 4 },
      (_, i) => [`big_${i}`, { type: 'noul', instructions: 'x'.repeat(7000) }] as [string, WireQuestion],
    );
    const batches = batchQuestions('s', big, {
      maxQuestions: 50,
      maxRequestTokens: 4500,
      maxStatePlusQuestionTokens: 31_000,
    });
    expect(batches.length).toBeGreaterThanOrEqual(2);
  });

  it('is deterministic', () => {
    expect(batchQuestions({ d: 1 }, s1)).toEqual(batchQuestions({ d: 1 }, [...s1].reverse()));
  });
});
