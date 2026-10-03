// Spec 003 tech §11 `interpret-features.test.ts` (FR-FEAT-001…010, 012, 015).
import type { Answer } from '@domains-all/jev';
import { describe, expect, it } from 'vitest';
import { interpretFeatures } from '../src/features/interpret';
import { detectByRules } from '../src/features/rules';

const rules = detectByRules('Online bakery in Pune delivering sourdough and cakes');
const choice = (
  choice: string,
  probabilities: Record<string, number>,
  confidence = probabilities[choice]!,
): Answer => ({
  type: 'choice',
  choice,
  probabilities,
  confidence,
});

const answers: Record<string, Answer> = {
  site_type: choice('online_store', { online_store: 0.62, restaurant_cafe: 0.3, other: 0.08 }),
  industry: choice('food__bakery', { food__bakery: 0.9, food__food_delivery: 0.1 }),
  audience: choice('local_community', { local_community: 0.5, consumers_general: 0.45, other: 0.05 }),
  geo_scope: choice('country_in', { country_in: 0.97, global: 0.03 }),
  language: choice('en', { en: 0.99, hi: 0.01 }),
  name_style: choice('compound', { compound: 0.7, descriptive: 0.3 }),
  tone: { type: 'score', score: 1.2, probabilities: [0.1, 0.6, 0.3, 0, 0], confidence: 0.6 },
  clarity: { type: 'score', score: 2.4, probabilities: [0, 0.1, 0.4, 0.5], confidence: 0.5 },
  feat_sells_physical: { type: 'noul', noul: 0.82 },
  feat_food: { type: 'noul', noul: 0.95 },
  feat_crypto: { type: 'noul', noul: 0.01 },
  feat_finance: { type: 'noul', noul: 0.61 },
  safety_adult: { type: 'noul', noul: 0.02 },
};
const refs = { site_type: 'site_type@1', industry: 'industry@1', feat_food: 'feat_food@1' };

describe('interpretFeatures', () => {
  const p = interpretFeatures({ answers, rules, prefs: { country: 'auto' }, refs });

  it('takes values and confidences from Jev', () => {
    expect(p.siteType).toMatchObject({
      value: 'online_store',
      confidence: 0.62,
      source: 'jev',
      unsure: false,
    });
    expect(p.industry.value).toBe('food__bakery');
    expect(p.geo.value).toBe('country_in');
    expect(p.source).toBe('jev');
    expect(p.catalogVersions).toEqual({ site_type: 1, industry: 1, feat_food: 1 });
  });

  it('marks low-confidence chips as unsure and offers alternatives ≥ 10 % (US-3)', () => {
    expect(p.audience).toMatchObject({ value: 'local_community', unsure: true });
    expect(p.audience.alternatives).toEqual([{ value: 'consumers_general', p: 0.45 }]);
    expect(p.siteType.alternatives.map((a) => a.value)).toEqual(['restaurant_cafe']);
  });

  it('turns flags on at 0.60 and maps tone and clarity', () => {
    expect(p.flags.feat_sells_physical.on).toBe(true);
    expect(p.flags.feat_finance.on).toBe(true);
    expect(p.flags.feat_crypto.on).toBe(false);
    expect(p.tone.level).toBe(1);
    expect(p.clarity).toEqual({ score: 2.4, tooVague: false });
  });

  it('derives sensitive categories (FR-FEAT-015)', () => {
    expect(p.sensitive).toEqual(['finance']);
    const adult = interpretFeatures({
      answers: { ...answers, safety_adult: { type: 'noul', noul: 0.9 } },
      rules,
      prefs: { country: 'auto' },
      refs,
    });
    expect(adult.sensitive).toContain('adult');
  });

  it('lets a country preference override detection (FR-FEAT-012)', () => {
    const gb = interpretFeatures({ answers, rules, prefs: { country: 'gb' }, refs });
    expect(gb.geo).toMatchObject({ value: 'country_gb', edited: true, source: 'user', unsure: false });
    expect(interpretFeatures({ answers, rules, prefs: { country: 'global' }, refs }).geo.value).toBe(
      'global',
    );
    expect(interpretFeatures({ answers, rules, prefs: { country: 'zz' }, refs }).geo.value).toBe(
      'other_country',
    );
  });

  it('fills unanswered fields from the rules and marks them unsure (FR-FEAT-014)', () => {
    const partial = { ...answers };
    delete partial.industry;
    delete partial.tone;
    const q = interpretFeatures({ answers: partial, rules, prefs: { country: 'auto' }, refs });
    expect(q.industry).toMatchObject({ value: 'food__bakery', source: 'rules', unsure: true });
    expect(q.industry.confidence).toBeLessThanOrEqual(0.4);
    expect(q.tone).toMatchObject({ level: 2, source: 'rules' });
    expect(q.source).toBe('jev');
  });

  it('reports a fully rule-based profile when Jev answered nothing', () => {
    const q = interpretFeatures({ answers: {}, rules, prefs: { country: 'auto' }, refs: {} });
    expect(q.source).toBe('rules');
    expect(q.geo.value).toBe('country_in');
    expect(q.flags.feat_food.on).toBe(true);
  });
});
