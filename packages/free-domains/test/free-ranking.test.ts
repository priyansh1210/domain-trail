// Spec 007 tech §11 `free-ranking.test.ts` (FR-FREE-004, 006, 007): scoring, caps per provider, conditions with
// the name filled in, taken names removed.
import { describe, expect, it } from 'vitest';
import type { FreeChecker } from '../src/check';
import { PROVIDERS } from '../src/providers';
import { findFreeNames } from '../src/rank';

const checker = (taken: string[] = [], unverifiable: string[] = []): FreeChecker => ({
  check: async (label, p) =>
    taken.includes(`${label}.${p.suffix}`)
      ? 'taken'
      : unverifiable.includes(p.id) || p.checkMethod === 'none'
        ? 'not_verifiable'
        : 'appears_free',
});

const labels = Array.from({ length: 10 }, (_, i) => ({ label: `crumb${i}`, relevance: 1 - i / 10 }));

describe('free results', () => {
  it('keeps at most 15 results and 5 per provider, best first', async () => {
    const results = await findFreeNames({ labels, providers: PROVIDERS, checker: checker() });
    expect(results.length).toBe(15);
    const per = new Map<string, number>();
    for (const r of results) per.set(r.providerId, (per.get(r.providerId) ?? 0) + 1);
    expect(Math.max(...per.values())).toBeLessThanOrEqual(5);
    expect(results[0]!.score).toBeGreaterThanOrEqual(results.at(-1)!.score);
  });

  it('removes taken names and ranks verified ones above "not verifiable"', async () => {
    const providers = PROVIDERS.filter((p) => ['eu-org', 'vercel-app'].includes(p.id));
    const results = await findFreeNames({
      labels: labels.slice(0, 2),
      providers,
      checker: checker(['crumb0.eu.org']),
    });
    expect(results.map((r) => r.fqdn)).not.toContain('crumb0.eu.org');
    const eu = results.find((r) => r.fqdn === 'crumb1.eu.org')!;
    const vercel = results.find((r) => r.fqdn === 'crumb1.vercel.app')!;
    expect(eu.status).toBe('appears_free');
    expect(vercel.status).toBe('not_verifiable');
  });

  it('shows conditions with the name filled in, and allows hyphens only on hosting addresses', async () => {
    const providers = PROVIDERS.filter((p) => ['is-a-dev', 'cf-pages'].includes(p.id));
    const results = await findFreeNames({
      labels: [{ label: 'crumb-app', relevance: 1 }],
      providers,
      checker: checker(),
    });
    expect(results.map((r) => r.fqdn)).toEqual(['crumb-app.pages.dev']);
    expect(results[0]!.conditions.steps[0]).toContain('crumb-app');
    expect(results[0]!.conditions.url).toBe('https://pages.cloudflare.com');
  });
});
