// Spec 004 tech §11 `generate.perf.test.ts` (NFR-GEN-001): generation + filtering under 300 ms (local CPU only).
import { describe, expect, it } from 'vitest';
import { generate } from '../src/generation/generate';
import { relatedWords } from '../src/generation/related';
import { extractTerms, weighTerms } from '../src/generation/terms';
import { profileFor } from './support/profile';

const CASES = [
  'Online bakery in Pune delivering sourdough bread and cakes to families',
  'Open-source command line tool that helps developers find slow database queries',
  'Portfolio for a freelance wedding photographer in Lisbon with galleries and a booking form',
];

describe('generation speed', () => {
  it('generates and filters candidates within the CPU budget', async () => {
    const run = async (d: string) => {
      const profile = profileFor(d);
      const terms = weighTerms(extractTerms(d, profile));
      const { expansions } = await relatedWords(terms, { live: false });
      const t0 = performance.now();
      const r = generate({
        description: d,
        profile,
        preferences: { maxLength: 15, allowHyphens: false, allowDigits: true },
        terms,
        expansions,
        seed: d,
        strictBrand: false,
        descBrandTokens: [],
      });
      return { ms: performance.now() - t0, count: r.candidates.length };
    };
    // One untimed run first: word lists and the brand index load once per server instance, not per search.
    await run(CASES[0]!);
    const times: number[] = [];
    for (const d of CASES) {
      const { ms, count } = await run(d);
      times.push(ms);
      expect(count).toBeGreaterThan(100);
    }
    // Generous margin for shared CI runners; the target on a normal machine is < 300 ms.
    expect(Math.max(...times)).toBeLessThan(process.env.CI ? 900 : 300);
  });
});
