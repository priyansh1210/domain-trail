// Spec 004 tech §11 `extract-terms.test.ts` (FR-GEN-001, FR-GEN-017).
import { describe, expect, it } from 'vitest';
import { extractTerms, keywordOptions, placesIn, weighTerms } from '../src/generation/terms';
import { profileFor } from './support/profile';

const BAKERY = 'Online bakery in Pune delivering sourdough bread and cakes to families';

describe('extractTerms', () => {
  it('keeps nouns, adjectives and two-word phrases, and drops generic words', () => {
    const terms = extractTerms(BAKERY).map((t) => t.text);
    expect(terms).toEqual(
      expect.arrayContaining(['bakery', 'sourdough', 'bread', 'cake', 'sourdough bread']),
    );
    expect(terms).not.toContain('online');
    expect(terms).not.toContain('the');
  });

  it('keeps brand words out of the key terms', () => {
    expect(extractTerms('Like Amazon but for used books and rare comics').map((t) => t.text)).not.toContain(
      'amazon',
    );
  });

  it('adds hints from the profile and named places for local sites', () => {
    const terms = extractTerms(BAKERY, profileFor(BAKERY));
    expect(terms.find((t) => t.text === 'pune')?.kind).toBe('geo');
    const hints = ['bake', 'loaf', 'crumb', 'crust', 'oven', 'dough'];
    expect(terms.some((t) => t.kind === 'hint' && hints.includes(t.text))).toBe(true);
    expect(placesIn('A cafe in Berlin and Munich')).toEqual(['berlin', 'munich']);
  });

  it('romanizes non-Latin descriptions (FR-GEN-017)', () => {
    const terms = extractTerms('जयपुर में हस्तनिर्मित चांदी के गहनों की ऑनलाइन दुकान');
    expect(terms.length).toBeGreaterThan(3);
    for (const t of terms) expect(t.text).toMatch(/^[a-z0-9 ]+$/);
    expect(terms.map((t) => t.text)).not.toContain('kii');
  });

  it('caps the list at 60 terms and builds t00 options for Jev', () => {
    const words = Array.from(
      { length: 90 },
      (_, i) => `word${String.fromCharCode(97 + (i % 26))}${String.fromCharCode(97 + Math.floor(i / 26))}x`,
    );
    expect(extractTerms(`A shop selling ${words.join(' ')}`).length).toBeLessThanOrEqual(60);
    expect(keywordOptions([{ text: 'bread', kind: 'word', tf: 1 }])).toEqual({ t00: 'bread' });
  });
});

describe('weighTerms (FR-GEN-002)', () => {
  const terms = extractTerms(BAKERY);

  it('uses frequency × specificity without Jev and marks 8 core terms', () => {
    const w = weighTerms(terms);
    expect(w.filter((t) => t.core)).toHaveLength(8);
    expect(w.reduce((a, t) => a + t.w, 0)).toBeCloseTo(1);
    expect(w.findIndex((t) => t.text === 'sourdough')).toBeLessThan(w.findIndex((t) => t.text === 'family'));
  });

  it('blends 70 % Jev with 30 % frequency when Jev answered', () => {
    const idx = terms.findIndex((t) => t.text === 'cake');
    const key = `t${String(idx).padStart(2, '0')}`;
    const w = weighTerms(terms, { type: 'choice', choice: key, probabilities: { [key]: 1 }, confidence: 1 });
    expect(w[0]!.text).toBe('cake');
    expect(w[0]!.w).toBeGreaterThan(0.7);
  });
});
