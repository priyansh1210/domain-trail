// Spec 007 tech §11 `provider-seed.test.ts` (FR-FREE-001, 009, 010, NFR-FREE-003): seed shape, required fields,
// human review age, and wildcard suffixes never use a DNS check (research R-08).
import { describe, expect, it } from 'vitest';
import { PROVIDERS, PROVIDERS_REVIEWED_AT } from '../src/providers';

describe('free provider seed', () => {
  it('has every required field', () => {
    expect(PROVIDERS.length).toBeGreaterThanOrEqual(8);
    for (const p of PROVIDERS) {
      expect(p.id, p.id).toMatch(/^[a-z0-9-]+$/);
      expect(p.steps.length, p.id).toBeGreaterThan(0);
      expect(p.officialUrl, p.id).toMatch(/^https:\/\//);
      expect(p.eligibility.note.length, p.id).toBeGreaterThan(5);
      if (p.checkMethod === 'github_list') expect(p.checkConfig?.url, p.id).toMatch(/^https:\/\//);
    }
    expect(new Set(PROVIDERS.map((p) => p.id)).size).toBe(PROVIDERS.length);
  });

  it('was reviewed by a person within the last 90 days (warning threshold)', () => {
    const ageDays = (Date.now() - Date.parse(PROVIDERS_REVIEWED_AT)) / 86_400_000;
    expect(ageDays).toBeLessThan(90);
  });

  it('never uses DNS for suffixes that answer every name, and leaves out suspended providers', () => {
    const wildcards = ['vercel.app', 'netlify.app', 'github.io', 'is-a.dev', 'js.org'];
    for (const p of PROVIDERS.filter((x) => wildcards.includes(x.suffix))) expect(p.checkMethod, p.id).not.toBe('doh');
    expect(PROVIDERS.some((p) => p.suffix === 'us.kg')).toBe(false);
    expect(PROVIDERS.filter((p) => p.kind === 'platform_address').length).toBeGreaterThanOrEqual(3);
  });
});
