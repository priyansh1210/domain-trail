// Spec 008 tech §11 `round2.test.ts` (FR-RANK-002, 003, 004, 011, 016): shrinkage, exclusions, extension fit.
import type { Answer } from '@domains-all/jev';
import { describe, expect, it } from 'vitest';
import type { Candidate } from '../src/generation/prefilter';
import { rankRound2 } from '../src/ranking/rounds';
import { failingJev, scriptedJev } from './support/profile';

const cand = (label: string): Candidate => ({
  label,
  strategy: 'compound',
  sourceTerms: [],
  quality: 0.7,
  keywordCoverage: 0.5,
  flags: { segments: [label], realWords: 1, hasDigit: false, hasHyphen: false },
});
const top = [cand('crumbcraft'), cand('loafly'), cand('brandish'), cand('rudename')];
const base = {
  state: { description: 'bakery' },
  pool: ['com', 'shop', 'cafe'],
  preferredTlds: [],
  flagsOn: ['feat_food'],
  searchId: 's',
};

const jev = scriptedJev((name): Answer | undefined => {
  if (name === 'rank_fit__0')
    return { type: 'score', score: 4, probabilities: [0, 0, 0, 0, 1], confidence: 1 };
  if (name === 'rank_fit__1')
    return { type: 'score', score: 4, probabilities: [0, 0, 0, 0, 1], confidence: 0.2 };
  if (name.startsWith('rank_fit__'))
    return { type: 'score', score: 2, probabilities: [0, 0, 1, 0, 0], confidence: 1 };
  if (name === 'risk_brand__2') return { type: 'noul', noul: 0.8 };
  if (name === 'risk_negative__3') return { type: 'noul', noul: 0.7 };
  if (name.startsWith('risk_')) return { type: 'noul', noul: 0.05 };
  if (name === 'tld_fit')
    return {
      type: 'choice',
      choice: 'tld_cafe',
      probabilities: { tld_com: 0.1, tld_shop: 0.3, tld_cafe: 0.6 },
      confidence: 0.6,
    };
  return undefined;
});

describe('round 2', () => {
  it('shrinks uncertain ratings towards the middle', async () => {
    const r = await rankRound2(top, { ...base, jev });
    const byLabel = new Map(r.items.map((i) => [i.label, i]));
    expect(byLabel.get('crumbcraft')!.R).toBeCloseTo(1);
    expect(byLabel.get('loafly')!.R).toBeCloseTo(0.2 * 1 + 0.8 * 0.5); // confidence 0.2
    expect(byLabel.get('crumbcraft')!.source).toBe('jev');
  });

  it('excludes brand look-alikes (≥ 0.50) and negative meanings (≥ 0.60) (FR-RANK-003)', async () => {
    const r = await rankRound2(top, { ...base, jev });
    expect(r.items.map((i) => i.label)).toEqual(['crumbcraft', 'loafly']);
    expect(r.excluded).toBe(2);
  });

  it('scales extension fit to the best one, keeps .com at 0.6+, boosts preferred extensions (FR-RANK-004, 011)', async () => {
    const r = await rankRound2(top, { ...base, preferredTlds: ['shop'], jev });
    expect(r.tldFit.get('cafe')).toBeCloseTo(1);
    expect(r.tldFit.get('com')).toBe(0.6);
    expect(r.tldFit.get('shop')).toBe(0.9);
  });

  it('asks brand and negative questions with a label-only state, so chip edits can reuse them (FR-RANK-016)', async () => {
    const spy = scriptedJev(() => undefined);
    await rankRound2(top, { ...base, jev: spy });
    const risk = spy.calls.find((c) => c.questions.some((q) => q.name.startsWith('risk_')))!;
    expect(risk.state).toBe('Domain name candidates');
    expect(risk.questions.every((q) => q.name.startsWith('risk_'))).toBe(true);
  });

  it('uses deterministic relevance and rule-based extension fit when Jev fails (FR-RANK-014)', async () => {
    const r = await rankRound2(top, { ...base, jev: failingJev() });
    expect(r.items).toHaveLength(4);
    expect(r.items[0]!.source).toBe('deterministic');
    expect(r.items[0]!.R).toBeCloseTo(0.6 * 0.5 + 0.4 * 0.7);
    expect(r.tldFit.get('cafe')).toBeGreaterThan(r.tldFit.get('shop') ?? 0); // FLAG_TLDS order for feat_food
    expect(r.degraded).toBe(true);
  });
});
