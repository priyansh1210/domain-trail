// Spec 004 tech §11 `find-more.test.ts` (FR-GEN-015): names already shown in the search never come back.
import { describe, expect, it } from 'vitest';
import { generate } from '../src/generation/generate';
import { relatedWords } from '../src/generation/related';
import { extractTerms, weighTerms } from '../src/generation/terms';
import { profileFor } from './support/profile';

describe('find more', () => {
  it('excludes every label already shown', async () => {
    const D = 'Online bakery delivering sourdough bread and cakes to families';
    const profile = profileFor(D);
    const terms = weighTerms(extractTerms(D, profile));
    const { expansions } = await relatedWords(terms, { live: false });
    const base = {
      description: D,
      profile,
      preferences: { maxLength: 15, allowHyphens: false, allowDigits: true },
      terms,
      expansions,
      seed: 's',
      strictBrand: false,
      descBrandTokens: [],
    };
    const first = generate(base).candidates.map((c) => c.label);
    const shown = new Set(first.slice(0, 50));
    const more = generate({ ...base, exclude: shown }).candidates.map((c) => c.label);
    for (const l of more) expect(shown.has(l)).toBe(false);
    expect(more.length).toBeGreaterThan(0);
  });
});
