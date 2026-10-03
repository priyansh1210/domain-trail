// Spec 007 tech §11 `github-tree.test.ts` (FR-FREE-003): taken lists from public repositories; lookups; the list is
// downloaded once per 12 hours and a failed download keeps the previous one.
import { describe, expect, it, vi } from 'vitest';
import { createFreeChecker, parseTakenList } from '../src/check';
import { PROVIDERS } from '../src/providers';

const isADev = PROVIDERS.find((p) => p.id === 'is-a-dev')!;
const jsOrg = PROVIDERS.find((p) => p.id === 'js-org')!;
const tree = JSON.stringify({
  tree: [
    { path: 'domains/priya.json' },
    { path: 'domains/_psl.json' },
    { path: 'domains/sub/x.json' },
    { path: 'README.md' },
  ],
});

describe('taken lists', () => {
  it('reads repository trees and JS key lists', () => {
    expect([...parseTakenList('tree', tree, { prefix: 'domains/', ext: '.json' })]).toEqual([
      'priya',
      '_psl',
    ]);
    expect([
      ...parseTakenList(
        'js_keys',
        'var cnames_active = {\n  "react": "facebook.github.io/react",\n  "vue": "vuejs.github.io"\n}',
      ),
    ]).toEqual(['react', 'vue']);
  });

  it('checks names against the list, downloading it only once per window', async () => {
    let now = 0;
    const fetchFn = vi.fn(async () => new Response(tree));
    const checker = createFreeChecker({
      live: true,
      fetchFn: fetchFn as unknown as typeof fetch,
      now: () => now,
    });
    expect(await checker.check('priya', isADev)).toBe('taken');
    expect(await checker.check('crumbly', isADev)).toBe('appears_free');
    expect(fetchFn).toHaveBeenCalledTimes(1);
    now += 13 * 3600_000;
    await checker.check('crumbly', isADev);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('says "not verifiable" when the list cannot be downloaded', async () => {
    const down = vi.fn(async () => new Response('', { status: 500 }));
    const checker = createFreeChecker({ live: true, fetchFn: down as unknown as typeof fetch });
    expect(await checker.check('react', jsOrg)).toBe('not_verifiable');
  });
});
