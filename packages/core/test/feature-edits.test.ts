// Spec 003 FR-FEAT-011: edited chips use catalog values only and are marked as edited by the user.
import { describe, expect, it } from 'vitest';
import { applyFeatureEdits, EDIT_OPTIONS, FeatureEditsSchema, hasEdits } from '../src/features/edit';
import { profileFor } from './support/profile';

describe('feature edits', () => {
  const base = profileFor('Online bakery in Pune delivering sourdough bread and cakes');

  it('accepts catalog values and rejects anything else', () => {
    expect(
      FeatureEditsSchema.safeParse({ geo: 'country_in', tone: 2, flags: { feat_local: true } }).success,
    ).toBe(true);
    for (const bad of [
      { geo: 'mars' },
      { tone: 9 },
      { flags: { feat_unknown: true } },
      { industry: '<script>' },
    ])
      expect(FeatureEditsSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    expect(EDIT_OPTIONS.geo).toContain('global');
    expect(EDIT_OPTIONS.industry.length).toBeGreaterThan(100);
  });

  it('applies edits and marks them as the user’s', () => {
    const edited = applyFeatureEdits(base, { geo: 'country_gb', tone: 4, flags: { feat_local: true } });
    expect(edited.geo).toEqual({
      value: 'country_gb',
      confidence: 1,
      alternatives: [],
      edited: true,
      source: 'user',
      unsure: false,
    });
    expect(edited.tone).toMatchObject({ level: 4, edited: true });
    expect(edited.flags.feat_local).toMatchObject({ on: true, edited: true });
    expect(edited.siteType).toBe(base.siteType); // untouched fields stay as detected
  });

  it('knows when nothing changes', () => {
    expect(hasEdits(base, { geo: base.geo.value })).toBe(false);
    expect(hasEdits(base, { geo: base.geo.value === 'global' ? 'country_in' : 'global' })).toBe(true);
  });
});
