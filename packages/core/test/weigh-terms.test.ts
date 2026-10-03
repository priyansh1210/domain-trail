// Spec 004 tech §11 `weigh-terms.test.ts` (FR-GEN-002): without a usable Jev answer, frequency weights only.
import { describe, expect, it } from 'vitest';
import { extractTerms, weighTerms } from '../src/generation/terms';

describe('weighTerms fallback', () => {
  it('ignores a missing or wrong-type answer', () => {
    const terms = extractTerms('Neighborhood bakery delivering sourdough bread and cakes');
    expect(weighTerms(terms, { type: 'noul', noul: 0.5 })).toEqual(weighTerms(terms));
    expect(weighTerms(terms, undefined)).toEqual(weighTerms(terms));
  });
});
