// Spec 004 tech §11 `determinism.test.ts` (FR-GEN-014), `find-more.test.ts` coverage lives in its own file.
import { describe, expect, it } from 'vitest';
import { generate } from '../src/generation/generate';
import { relatedWords } from '../src/generation/related';
import { extractTerms, weighTerms } from '../src/generation/terms';
import { profileFor } from './support/profile';

const D = 'Online bakery in Pune delivering sourdough bread and cakes to families';

async function run(seed: string) {
  const profile = profileFor(D);
  const terms = weighTerms(extractTerms(D, profile));
  const { expansions } = await relatedWords(terms, { live: false });
  return generate({
    description: D,
    profile,
    preferences: { maxLength: 15, allowHyphens: false, allowDigits: true },
    terms,
    expansions,
    seed,
    strictBrand: false,
    descBrandTokens: [],
  }).candidates.map((c) => c.label);
}

describe('generation is reproducible', () => {
  it('gives identical candidates for the same search', async () => {
    expect(await run('key-1')).toEqual(await run('key-1'));
  });

  it('varies the sampled styles with a different seed', async () => {
    expect(await run('key-1')).not.toEqual(await run('key-2'));
  });
});
