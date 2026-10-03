// Spec 003 tech §11 `taxonomy-seed.test.ts` (FR-FEAT-002): ≤ 200 industries, unique keys, every flag has seed
// keywords.
import { FLAG_STATEMENTS, siteType } from '@domains-all/jev';
import { describe, expect, it } from 'vitest';
import { FLAG_KEYWORDS, SITE_TYPE_KEYWORDS } from '../src/features/seed/signals';
import { GROUP_LABELS, INDUSTRY_OPTIONS, TAXONOMY } from '../src/features/seed/taxonomy';

describe('industry taxonomy', () => {
  it('has 141 entries in v1 and never more than 200', () => {
    expect(TAXONOMY).toHaveLength(141);
    expect(TAXONOMY.length).toBeLessThanOrEqual(200);
  });

  it('uses unique, valid option keys within the 255-option limit of a choice question', () => {
    const keys = TAXONOMY.map((i) => i.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const k of keys) expect(k).toMatch(/^[a-z_]+__[a-z0-9_]+$/);
    expect(Object.keys(INDUSTRY_OPTIONS).length).toBeLessThanOrEqual(255);
  });

  it('gives every entry a group label and keywords (except "other")', () => {
    for (const i of TAXONOMY) {
      expect(GROUP_LABELS[i.group], i.key).toBeDefined();
      if (i.key !== 'other__other') {
        expect(i.keywords.length, i.key).toBeGreaterThan(0);
        expect(i.wordHints.length, i.key).toBeGreaterThan(0);
      }
    }
  });
});

describe('fallback keyword seeds', () => {
  it('cover every feature flag and every site type', () => {
    expect(Object.keys(FLAG_KEYWORDS).sort()).toEqual(Object.keys(FLAG_STATEMENTS).sort());
    expect(Object.keys(SITE_TYPE_KEYWORDS).sort()).toEqual(
      Object.keys(siteType.criteria === 'runtime' ? {} : siteType.criteria).sort(),
    );
  });
});
