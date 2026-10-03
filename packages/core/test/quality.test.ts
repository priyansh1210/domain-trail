// Spec 004 tech §11 `quality.test.ts` (FR-GEN-008): the quality score orders names sensibly.
import { describe, expect, it } from 'vitest';
import { pronounceability, qualityOf, segment, shape } from '../src/generation/quality';

describe('quality score', () => {
  it('prefers readable names over letter soup (spec example: "breadly" > "brdxq")', () => {
    expect(qualityOf('breadly')).toBeGreaterThan(qualityOf('brdxq'));
    expect(qualityOf('sunnycrust')).toBeGreaterThan(qualityOf('sunny-crust-24'));
    expect(qualityOf('crumbcraft')).toBeGreaterThan(qualityOf('bakerypuneonlinedelivery'));
    expect(qualityOf('loavia')).toBeGreaterThan(qualityOf('xqzvtk'));
  });

  it('keeps good names above the cut-off and junk below it', () => {
    for (const good of ['sunnycrust', 'crumbcraft', 'querysleuth', 'loafly', 'breadhub'])
      expect(qualityOf(good), good).toBeGreaterThanOrEqual(0.5);
    for (const bad of ['brdxq', 'qwrtpzk', 'zzxcvbn']) expect(qualityOf(bad), bad).toBeLessThan(0.35);
  });

  it('splits labels into dictionary words with as few pieces as possible', () => {
    expect(segment('sunnycrust')).toEqual(['sunny', 'crust']);
    expect(segment('breadhub')).toEqual(['bread', 'hub']);
    expect(segment('zapora')).toBeNull();
    expect(shape('bread-hub24')).toMatchObject({
      segments: ['bread', 'hub'],
      hasDigit: true,
      hasHyphen: true,
    });
  });

  it('scores pronounceability between 0 and 1', () => {
    expect(pronounceability('bakery')).toBeGreaterThan(0.8);
    expect(pronounceability('xqzvt')).toBeLessThan(0.3);
  });
});
