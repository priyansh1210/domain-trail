// Spec 001 FR-INT-003 (`examples.test.ts`): at least 6 examples, globally neutral, varied site types.
import { describe, expect, it } from 'vitest';
import { EXAMPLES } from '../src/intake/examples';
import { detectByRules } from '../src/features/rules';
import { GAZETTEER } from '../src/features/seed/signals';
import { SearchRequestSchema } from '../src/intake/request';

describe('example descriptions', () => {
  it('offers at least 6 valid examples', () => {
    expect(EXAMPLES.length).toBeGreaterThanOrEqual(6);
    for (const e of EXAMPLES) {
      expect(
        SearchRequestSchema.safeParse({
          description: e.description,
          turnstileToken: 't',
          clientRequestId: '0190f5a8-0000-7000-8000-000000000001',
        }).success,
      ).toBe(true);
    }
  });

  it('names no country, city or currency (owner decision: globally neutral)', () => {
    const places = Object.values(GAZETTEER).flat();
    for (const e of EXAMPLES) {
      const text = ` ${e.description.toLowerCase().replace(/[^\p{L}\s]/gu, ' ')} `;
      for (const p of places) expect(text.includes(` ${p} `), `${e.label}: ${p}`).toBe(false);
      expect(e.description).not.toMatch(/[$€£₹¥]|\b(usd|eur|inr|gbp|rupees?|dollars?|euros?)\b/i);
    }
  });

  it('covers different kinds of website', () => {
    const types = new Set(EXAMPLES.map((e) => Object.keys(detectByRules(e.description).siteType)[0]));
    expect(types.size).toBeGreaterThanOrEqual(5);
  });
});
