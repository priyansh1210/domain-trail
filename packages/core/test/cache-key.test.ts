// Spec 001 tech §11 `cache-key.test.ts` (FR-INT-008).
import { describe, expect, it } from 'vitest';
import { cacheKey } from '../src/intake/ids';
import { PreferencesSchema } from '../src/intake/schema';

const prefs = (p: object) => PreferencesSchema.parse(p);

describe('cache key', () => {
  it('ignores the order of preferred extensions', () => {
    expect(cacheKey('a bakery', prefs({ preferredTlds: ['com', 'shop'] }))).toBe(
      cacheKey('a bakery', prefs({ preferredTlds: ['shop', 'com'] })),
    );
  });

  it('changes when the description, a preference or the pipeline version changes', () => {
    const base = cacheKey('a bakery', prefs({}));
    expect(cacheKey('a bakery!', prefs({}))).not.toBe(base);
    expect(cacheKey('a bakery', prefs({ allowDigits: false }))).not.toBe(base);
    expect(cacheKey('a bakery', prefs({}), '9.9.9')).not.toBe(base);
  });
});
