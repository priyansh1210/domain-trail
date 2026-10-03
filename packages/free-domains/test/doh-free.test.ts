// Spec 007 tech §11 `doh-free.test.ts` (FR-FREE-003, FR-FREE-010): DNS rules for suffixes without wildcards;
// providers without a permitted check are "not verifiable"; fixture mode never goes online.
import { describe, expect, it, vi } from 'vitest';
import { createFreeChecker } from '../src/check';
import { PROVIDERS } from '../src/providers';

const p = (id: string) => PROVIDERS.find((x) => x.id === id)!;

describe('DNS checks for free names', () => {
  it('reads registered (NS) and resolving (A) answers', async () => {
    const fetchFn = vi.fn(async (url: string) => {
      const name = new URL(url).searchParams.get('name')!;
      if (name === 'taken.eu.org') return Response.json({ Status: 0, Answer: [{ name: 'taken.eu.org.', type: 2 }] });
      if (name === 'used.pages.dev') return Response.json({ Status: 0, Answer: [{ name: 'used.pages.dev.', type: 1 }] });
      return Response.json({ Status: 3 });
    });
    const checker = createFreeChecker({ live: true, fetchFn: fetchFn as unknown as typeof fetch });
    expect(await checker.check('taken', p('eu-org'))).toBe('taken');
    expect(await checker.check('crumbly', p('eu-org'))).toBe('appears_free');
    expect(await checker.check('used', p('cf-pages'))).toBe('taken');
    expect(await checker.check('crumbly', p('cf-pages'))).toBe('appears_free');
  });

  it('never checks platforms without a permitted method, and stays offline in fixture mode', async () => {
    const fetchFn = vi.fn();
    const live = createFreeChecker({ live: true, fetchFn: fetchFn as unknown as typeof fetch });
    expect(await live.check('crumbly', p('vercel-app'))).toBe('not_verifiable');
    expect(await live.check('crumbly', p('github-io'))).toBe('not_verifiable');
    const offline = createFreeChecker({ live: false, fetchFn: fetchFn as unknown as typeof fetch });
    expect(['taken', 'appears_free']).toContain(await offline.check('crumbly', p('eu-org')));
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
