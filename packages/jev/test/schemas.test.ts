// Spec 002 tech §11 `schemas.test.ts` (FR-JEV-004).
import { describe, expect, it } from 'vitest';
import type { WireQuestion } from '../src/types';
import { validateAnswer } from '../src/validate';

const choice: WireQuestion = { type: 'choice', instructions: 'x', criteria: { a: 'A', b: 'B' } };
const score: WireQuestion = { type: 'score', instructions: 'x', criteria: ['low', 'mid', 'high'] };
const noul: WireQuestion = { type: 'noul', instructions: 'x' };

describe('validateAnswer', () => {
  it('accepts a valid choice and renormalizes small drift', () => {
    const v = validateAnswer(
      { type: 'choice', choice: 'a', probabilities: { a: 0.7, b: 0.31 }, confidence: 0.7 },
      choice,
    );
    expect(v.ok).toBe(true);
    if (v.ok && v.answer.type === 'choice')
      expect(v.answer.probabilities.a! + v.answer.probabilities.b!).toBeCloseTo(1);
  });

  it('rejects unknown choices, unknown keys and bad sums', () => {
    expect(
      validateAnswer({ type: 'choice', choice: 'z', probabilities: { a: 1 }, confidence: 1 }, choice),
    ).toMatchObject({ ok: false, reason: 'unknown_choice' });
    expect(
      validateAnswer(
        { type: 'choice', choice: 'a', probabilities: { a: 0.5, z: 0.5 }, confidence: 1 },
        choice,
      ),
    ).toMatchObject({ ok: false, reason: 'unknown_key' });
    expect(
      validateAnswer(
        { type: 'choice', choice: 'a', probabilities: { a: 0.5, b: 0.2 }, confidence: 1 },
        choice,
      ),
    ).toMatchObject({ ok: false, reason: 'probability_sum' });
    expect(validateAnswer({ type: 'noul', noul: 0.5 }, choice)).toMatchObject({ ok: false, reason: 'shape' });
  });

  it('accepts score probabilities as an array or an object (R-01)', () => {
    expect(
      validateAnswer({ type: 'score', score: 1.2, probabilities: [0.2, 0.4, 0.4], confidence: 0.5 }, score)
        .ok,
    ).toBe(true);
    const v = validateAnswer(
      { type: 'score', score: 1, probabilities: { '0': 0.1, '1': 0.8, '2': 0.1 }, confidence: 0.8 },
      score,
    );
    expect(v.ok && v.answer.type === 'score' ? v.answer.probabilities : null).toEqual([0.1, 0.8, 0.1]);
  });

  it('rejects scores outside the rubric or with the wrong number of levels', () => {
    expect(
      validateAnswer({ type: 'score', score: 3, probabilities: [0.2, 0.4, 0.4], confidence: 1 }, score),
    ).toMatchObject({ ok: false, reason: 'score_range' });
    expect(
      validateAnswer({ type: 'score', score: 1, probabilities: [0.5, 0.5], confidence: 1 }, score),
    ).toMatchObject({ ok: false, reason: 'levels' });
  });

  it('checks noul is a probability', () => {
    expect(validateAnswer({ type: 'noul', noul: 0.4 }, noul).ok).toBe(true);
    expect(validateAnswer({ type: 'noul', noul: 1.4 }, noul).ok).toBe(false);
    expect(validateAnswer(undefined, noul).ok).toBe(false);
  });
});
