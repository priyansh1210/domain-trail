// Spec 001 tech §11 `schema.test.ts` (FR-INT-002, 004, 005).
import { describe, expect, it } from 'vitest';
import { SearchRequestSchema } from '../src/intake/request';
import { PreferencesSchema } from '../src/intake/schema';

const valid = {
  description: 'Neighborhood bakery delivering sourdough bread and cakes',
  turnstileToken: 'token',
  clientRequestId: '0190f5a8-0000-7000-8000-000000000001',
};

describe('search request schema', () => {
  it('applies the approved defaults (digits allowed, no hyphens, max 15)', () => {
    const r = SearchRequestSchema.parse(valid);
    expect(r.preferences).toEqual({
      preferredTlds: [],
      maxLength: 15,
      allowHyphens: false,
      allowDigits: true,
      country: 'auto',
      priceMinCents: 0,
      priceMaxCents: null,
      includeFree: true,
      forceSearch: false,
    });
  });

  it('measures the 20–2,000 character limits after normalizing', () => {
    expect(SearchRequestSchema.safeParse({ ...valid, description: '  short   text  ' }).success).toBe(false);
    expect(SearchRequestSchema.safeParse({ ...valid, description: 'a'.repeat(2000) }).success).toBe(true);
    expect(SearchRequestSchema.safeParse({ ...valid, description: 'a'.repeat(2001) }).success).toBe(false);
    // Removed links do not count towards the minimum.
    expect(
      SearchRequestSchema.safeParse({ ...valid, description: 'see https://example.com/very/long/path' })
        .success,
    ).toBe(false);
  });

  it('validates preferences', () => {
    expect(PreferencesSchema.safeParse({ maxLength: 5 }).success).toBe(false);
    expect(PreferencesSchema.safeParse({ maxLength: 21 }).success).toBe(false);
    expect(PreferencesSchema.safeParse({ country: 'india' }).success).toBe(false);
    expect(PreferencesSchema.safeParse({ country: 'in' }).success).toBe(true);
    expect(PreferencesSchema.safeParse({ preferredTlds: ['co.in', 'com'] }).success).toBe(true);
    expect(PreferencesSchema.safeParse({ preferredTlds: ['.com'] }).success).toBe(false);
    expect(PreferencesSchema.safeParse({ priceMinCents: 5000, priceMaxCents: 1000 }).success).toBe(false);
  });

  it('requires an idempotency id and a human-check token', () => {
    expect(SearchRequestSchema.safeParse({ ...valid, clientRequestId: 'nope' }).success).toBe(false);
    expect(SearchRequestSchema.safeParse({ ...valid, turnstileToken: '' }).success).toBe(false);
  });
});
