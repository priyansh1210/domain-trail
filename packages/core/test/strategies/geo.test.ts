// Spec 004 `strategies/geo.test.ts` (FR-GEN-012): place-based names when the site serves a place.
import { describe, expect, it } from 'vitest';
import { seededRng } from '../../src/generation/rng';
import { generateCandidates } from '../../src/generation/strategies';
import { INPUT } from './input';

describe('geo style', () => {
  it('puts the place before and after core terms', () => {
    const geo = generateCandidates(INPUT, seededRng('x'))
      .filter((c) => c.strategy === 'geo')
      .map((c) => c.label);
    expect(geo).toEqual(expect.arrayContaining(['punebread', 'breadpune', 'punebakery']));
  });

  it('is absent for sites without a place', () => {
    expect(
      generateCandidates({ ...INPUT, geoWords: [] }, seededRng('x')).some((c) => c.strategy === 'geo'),
    ).toBe(false);
  });
});
