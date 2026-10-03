// Spec 004 tech §11 `prefilter.test.ts` (FR-GEN-006…011, NFR-GEN-004).
import { describe, expect, it } from 'vitest';
import { diversify, isProfane, prefilter, type Candidate } from '../src/generation/prefilter';
import type { RawCandidate, Strategy } from '../src/generation/strategies';

const raw = (label: string, strategy: Strategy = 'compound'): RawCandidate => ({
  label,
  strategy,
  sourceTerms: [label],
});
const opts = { maxLength: 15, allowHyphens: false, allowDigits: true, weights: new Map([['bread', 0.5]]) };
const labels = (cands: RawCandidate[], o = {}) => prefilter(cands, { ...opts, ...o }).map((c) => c.label);

describe('prefilter', () => {
  it('keeps only valid domain labels (FR-GEN-006)', () => {
    expect(
      labels([
        raw('breadhub'),
        raw('-bread'),
        raw('bread-'),
        raw('bre ad'),
        raw('br_ead'),
        raw('x'.repeat(64)),
      ]),
    ).toEqual(['breadhub']);
  });

  it('applies the preferences (FR-GEN-007)', () => {
    const cands = [raw('breadhub'), raw('bread-hub'), raw('bread24'), raw('superbreadhublongname')];
    expect(labels(cands)).toEqual(expect.arrayContaining(['breadhub', 'bread24']));
    expect(labels(cands)).not.toContain('bread-hub');
    expect(labels(cands, { allowDigits: false })).not.toContain('bread24');
    // "bread-hub" is the same idea as "breadhub" (de-duplicated), so test hyphens on their own
    expect(labels([raw('bread-hub')], { allowHyphens: true })).toEqual(['bread-hub']);
    expect(labels(cands)).not.toContain('superbreadhublongname');
  });

  it('allows any number of hyphens when enabled, but never "--"', () => {
    expect(labels([raw('my-bread-hub'), raw('bread--hub')], { allowHyphens: true })).toEqual([
      'my-bread-hub',
    ]);
  });

  it('removes offensive words, including spelled with digits, but not innocent look-alikes (FR-GEN-009)', () => {
    expect(isProfane('bitchbread', ['bitch', 'bread'])).toBe(true);
    expect(isProfane('b1tchbread', ['b1tch', 'bread'])).toBe(true);
    expect(isProfane('classicbread', ['classic', 'bread'])).toBe(false);
    expect(labels([raw('classicbread'), raw('bitchbread')])).toEqual(['classicbread']);
  });

  it('removes brand look-alikes (FR-GEN-009)', () => {
    expect(labels([raw('breadhub'), raw('paypalbread'), raw('g00glebread')])).toEqual(['breadhub']);
  });

  it('removes triple letters, low quality, and excluded labels', () => {
    expect(
      labels([raw('breaaad'), raw('brdxqzv'), raw('breadhub'), raw('breadly')], {
        exclude: new Set(['breadly']),
      }),
    ).toEqual(['breadhub']);
  });

  it('merges singular and plural forms of one idea, keeping the better one (FR-GEN-010)', () => {
    const out = labels([raw('breadhub'), raw('breadhubs'), raw('breadshop'), raw('breadshops')]);
    expect(out.filter((l) => l.startsWith('breadhub'))).toHaveLength(1);
    expect(out.filter((l) => l.startsWith('breadshop'))).toHaveLength(1);
  });

  it('keeps any one style at or below 40 % and at most the maximum count (FR-GEN-011)', () => {
    const cand = (label: string, strategy: Strategy, q: number): Candidate => ({
      label,
      strategy,
      sourceTerms: [],
      quality: q,
      keywordCoverage: 0,
      flags: { segments: [label], realWords: 1, hasDigit: false, hasHyphen: false },
    });
    const many = [
      ...Array.from({ length: 50 }, (_, i) => cand(`a${i}`, 'compound', 0.9)),
      ...Array.from({ length: 30 }, (_, i) => cand(`b${i}`, 'affix', 0.6)),
      ...Array.from({ length: 30 }, (_, i) => cand(`c${i}`, 'brandable', 0.5)),
    ];
    const out = diversify(many, 60, 0.4);
    expect(out.length).toBeLessThanOrEqual(60);
    for (const s of ['compound', 'affix', 'brandable'])
      expect(out.filter((c) => c.strategy === s).length / out.length).toBeLessThanOrEqual(0.4);
  });
});
