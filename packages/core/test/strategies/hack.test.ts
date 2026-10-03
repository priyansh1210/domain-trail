// Spec 004 `strategies/hack.test.ts` (FR-GEN-013): the extension completes a word, only with known extensions.
import { describe, expect, it } from 'vitest';
import { seededRng } from '../../src/generation/rng';
import { generateCandidates } from '../../src/generation/strategies';
import { INPUT } from './input';

describe('hack style', () => {
  it('splits a word into label + extension (cak + .es)', () => {
    const hacks = generateCandidates(INPUT, seededRng('x')).filter((c) => c.strategy === 'hack');
    expect(hacks).toContainEqual(expect.objectContaining({ label: 'cak', hackTld: 'es' }));
  });

  it('uses only the extensions it is given', () => {
    expect(
      generateCandidates({ ...INPUT, hackTlds: [] }, seededRng('x')).some((c) => c.strategy === 'hack'),
    ).toBe(false);
  });
});
