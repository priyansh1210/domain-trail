// Spec 000/002 `degraded-mode.int.test.ts` for stage S1, plus the S1 part of `pipeline.perf.test.ts`:
// a search always gets a result, even when Jev is down or the budget is used up (FR-SYS-008, FR-JEV-016,
// NFR-JEV-005); features come back well inside the 2 s target in mock mode (NFR-SYS-001).
import {
  BudgetGuard,
  CircuitBreaker,
  createJev,
  MemoryUsageStore,
  parseServerEnvForTest,
} from './support/jev';
import { describe, expect, it } from 'vitest';
import { PreferencesSchema } from '../src/intake/schema';
import { runS1 } from '../src/pipeline/s1';
import { rulesMockHint } from '../src/features/mock-hint';

const prefs = PreferencesSchema.parse({});
const BAKERY = 'Online bakery in Pune delivering sourdough bread and cakes to families';

describe('stage S1', () => {
  it('returns features from the (mock) decision model', async () => {
    const jev = createJev({ env: parseServerEnvForTest({}), mockHint: rulesMockHint });
    const t0 = performance.now();
    const out = await runS1({ description: BAKERY, preferences: prefs, searchId: 's', jev });
    expect(performance.now() - t0).toBeLessThan(2000);
    expect(out.kind).toBe('features');
    if (out.kind !== 'features') return;
    expect(out.profile.source).toBe('jev');
    expect(out.profile.geo.value).toBe('country_in');
    expect(out.profile.industry.value).toBe('food__bakery');
    expect(out.degraded).toBeUndefined();
    expect(out.usage.requests).toBe(2);
  });

  it('falls back to rules when Jev is down, and says so', async () => {
    const jev = createJev({ env: parseServerEnvForTest({ MOCK_EXTERNALS: '0' }) }); // live, no key → every ask fails
    const out = await runS1({ description: BAKERY, preferences: prefs, searchId: 's', jev });
    expect(out.kind).toBe('features');
    if (out.kind !== 'features') return;
    expect(out.degraded).toBe('jev_unavailable');
    expect(out.profile.source).toBe('rules');
    expect(out.profile.industry.value).toBe('food__bakery');
  });

  it('reports budget exhaustion as the degraded reason', async () => {
    const store = new MemoryUsageStore();
    await store.addSearch({
      day: new Date().toISOString().slice(0, 10),
      tokens: 4_000_000,
      requests: 1,
      degraded: false,
    });
    const jev = createJev({ env: parseServerEnvForTest({}), usageStore: store, mockHint: rulesMockHint });
    const out = await runS1({ description: BAKERY, preferences: prefs, searchId: 's', jev });
    expect(out.kind === 'features' && out.degraded).toBe('budget');
    expect(BudgetGuard).toBeDefined();
    expect(CircuitBreaker).toBeDefined();
  });

  it('asks for more detail on vague descriptions unless "Search anyway" was chosen', async () => {
    const jev = createJev({ env: parseServerEnvForTest({}), mockHint: rulesMockHint });
    const vague = await runS1({ description: 'my new website idea', preferences: prefs, searchId: 's', jev });
    expect(vague).toMatchObject({ kind: 'needs_detail', hints: ['offering', 'audience', 'place'] });
    const anyway = await runS1({
      description: 'my new website idea',
      preferences: { ...prefs, forceSearch: true },
      searchId: 's',
      jev,
    });
    expect(anyway.kind).toBe('features');
  });

  it('refuses harmful requests without returning features', async () => {
    const jev = createJev({ env: parseServerEnvForTest({}), mockHint: rulesMockHint });
    const out = await runS1({
      description: 'A fake login page that looks like my bank website to collect passwords',
      preferences: prefs,
      searchId: 's',
      jev,
    });
    expect(out).toEqual({ kind: 'refused', usage: expect.any(Object) });
  });
});
