// Spec 004 `strategies/affix.test.ts` (FR-GEN-016): prefixes and suffixes, trending ones first.
import { describe, expect, it } from 'vitest';
import { seededRng } from '../../src/generation/rng';
import { generateCandidates } from '../../src/generation/strategies';
import { INPUT } from './input';

describe('affix style', () => {
  it('adds prefixes and suffixes with simple spelling rules', () => {
    const labels = generateCandidates(INPUT, seededRng('x'))
      .filter((c) => c.strategy === 'affix')
      .map((c) => c.label);
    expect(labels).toEqual(expect.arrayContaining(['trybread', 'breadhub', 'bakerly', 'cakify']));
  });

  it('includes trending affixes seen in new registrations', () => {
    const labels = generateCandidates(
      { ...INPUT, trendAffixes: { suffixes: ['verse'] } },
      seededRng('x'),
    ).map((c) => c.label);
    expect(labels).toContain('breadverse');
  });
});
