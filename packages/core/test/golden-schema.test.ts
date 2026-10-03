// Spec 016 tech §11 `golden-schema.test.ts` (FR-QA-004, FR-QA-011): every golden-set line is well formed and uses
// keys that exist in the question catalog and taxonomy. The full counts are enforced once the owner finishes
// labelling (tasks/M2-understand.md E1).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FLAG_STATEMENTS, geoScope, siteType } from '@domains-all/jev';
import { describe, expect, it } from 'vitest';
import { INDUSTRY_OPTIONS } from '../src/features/seed/taxonomy';
import { detectByRules } from '../src/features/rules';
import { safetyGate } from '../src/safety/gate';

interface Golden {
  id: string;
  category: 'benign' | 'vague' | 'harmful' | 'tricky_benign';
  lang: string;
  description: string;
  expected: Record<string, unknown>;
  goodNames?: string[];
  badNames?: string[];
}

const lines = readFileSync(join(import.meta.dirname, '..', '..', 'jev', 'eval', 'golden.jsonl'), 'utf8')
  .split('\n')
  .filter(Boolean);
const golden = lines.map((l) => JSON.parse(l) as Golden);
const keys = (def: { criteria: Record<string, string> | 'runtime' }) =>
  def.criteria === 'runtime' ? [] : Object.keys(def.criteria);

describe('golden set', () => {
  it('has unique ids and known categories', () => {
    expect(new Set(golden.map((g) => g.id)).size).toBe(golden.length);
    for (const g of golden) expect(['benign', 'vague', 'harmful', 'tricky_benign']).toContain(g.category);
  });

  it('uses only catalog and taxonomy keys in expected answers', () => {
    for (const g of golden.filter((x) => x.category === 'benign')) {
      const e = g.expected as {
        siteType: string;
        industryTop3: string[];
        geo: string;
        flagsOn: string[];
        flagsOff: string[];
      };
      expect(keys(siteType), g.id).toContain(e.siteType);
      expect(keys(geoScope), g.id).toContain(e.geo);
      for (const i of e.industryTop3) expect(Object.keys(INDUSTRY_OPTIONS), g.id).toContain(i);
      for (const f of [...e.flagsOn, ...e.flagsOff]) expect(Object.keys(FLAG_STATEMENTS), g.id).toContain(f);
      for (const n of [...(g.goodNames ?? []), ...(g.badNames ?? [])])
        expect(n, g.id).toMatch(/^[a-z0-9-]{1,63}$/);
    }
  });

  it('has good and bad names for every normal example, so ranking can be measured (NDCG@10)', () => {
    for (const g of golden.filter((x) => x.category === 'benign')) {
      expect(g.goodNames?.length ?? 0, g.id).toBeGreaterThanOrEqual(3);
      expect(g.badNames?.length ?? 0, g.id).toBeGreaterThanOrEqual(2);
    }
  });

  it('contains no e-mail addresses or phone numbers (FR-QA-011)', () => {
    for (const g of golden) {
      expect(g.description, g.id).not.toMatch(/[\w.+-]+@[\w-]+\.\w+/);
      expect(g.description, g.id).not.toMatch(/\+?\d[\d\s().-]{7,}\d/);
    }
  });

  it('includes the starter mix of categories, with non-English examples', () => {
    const count = (c: Golden['category']) => golden.filter((g) => g.category === c).length;
    expect(count('benign')).toBeGreaterThanOrEqual(20);
    expect(count('vague')).toBeGreaterThanOrEqual(5);
    expect(count('harmful')).toBeGreaterThanOrEqual(10);
    expect(count('tricky_benign')).toBeGreaterThanOrEqual(10);
    expect(new Set(golden.filter((g) => g.lang !== 'en').map((g) => g.lang)).size).toBeGreaterThanOrEqual(5);
  });

  it('the keyword fallback never refuses a tricky-but-harmless example', () => {
    for (const g of golden.filter((x) => x.category === 'tricky_benign')) {
      expect(safetyGate({}, detectByRules(g.description)), g.id).not.toBe('refuse');
    }
  });
});
