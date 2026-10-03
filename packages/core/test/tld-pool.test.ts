// Spec 003 tech §11 `tld-pool.test.ts` (FR-FEAT-013): order, cap 80, geo, flags, adult filtering.
import { describe, expect, it } from 'vitest';
import { buildTldPool, MAX_POOL, tldOptions } from '../src/ranking/tld-pool';
import { profileFor } from './support/profile';

describe('TLD pool', () => {
  it('puts preferred extensions first, then base, local and feature extensions', () => {
    const p = profileFor('Online bakery in Pune delivering sourdough bread and cakes to local families');
    const pool = buildTldPool(p, { preferredTlds: ['store'], country: 'auto' });
    expect(pool[0]).toBe('store');
    expect(pool).toEqual(expect.arrayContaining(['com', 'in', 'co.in', 'shop', 'cafe']));
    expect(pool.indexOf('in')).toBeLessThan(pool.indexOf('com')); // local business: country extension promoted
    expect(pool.length).toBeLessThanOrEqual(MAX_POOL);
  });

  it('follows a country preference over detection (FR-FEAT-012)', () => {
    const p = profileFor('Online bakery delivering sourdough bread and cakes');
    expect(buildTldPool(p, { preferredTlds: [], country: 'gb' })).toEqual(
      expect.arrayContaining(['uk', 'co.uk']),
    );
  });

  it('keeps adult-only extensions for adult sites only', () => {
    const adult = {
      ...profileFor('Adult content site for verified users over 18'),
      sensitive: ['adult' as const],
    };
    expect(buildTldPool(adult, { preferredTlds: ['xxx'], country: 'auto' })).toContain('xxx');
    expect(
      buildTldPool(profileFor('A bakery for families'), { preferredTlds: ['xxx'], country: 'auto' }),
    ).not.toContain('xxx');
  });

  it('builds tld_ option keys for Jev', () => {
    const { criteria, keyToTld } = tldOptions(['com', 'co.in']);
    expect(Object.keys(criteria)).toEqual(['tld_com', 'tld_co_in']);
    expect(keyToTld.get('tld_co_in')).toBe('co.in');
    expect(criteria.tld_com).toMatch(/^\.com — /);
  });
});
