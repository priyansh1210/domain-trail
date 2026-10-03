// Spec 005 tech §11 `doh.test.ts` (FR-AVL-002): NOERROR/NXDOMAIN/authority parsing, fallback provider.
import { describe, expect, it, vi } from 'vitest';
import { dohNs, dohQuery, nsVerdict, resolves } from '../src/doh';

const answer = (
  status: number,
  answer: Array<{ name: string; type: number }> = [],
  authority: typeof answer = [],
) => ({
  status,
  answer,
  authority,
});

describe('NS verdict', () => {
  it('reads registered, not found and unclear answers', () => {
    expect(nsVerdict('crumb.com', answer(0, [{ name: 'crumb.com.', type: 2 }]))).toBe('registered');
    expect(nsVerdict('crumb.com', answer(0, [], [{ name: 'crumb.com', type: 2 }]))).toBe('registered');
    expect(nsVerdict('crumb.com', answer(3))).toBe('not_found');
    // SOA of the TLD only (registered but not delegated is rare) → let RDAP decide
    expect(nsVerdict('crumb.com', answer(0, [], [{ name: 'com.', type: 6 }]))).toBe('unclear');
    expect(nsVerdict('crumb.com', answer(2))).toBe('unclear');
    expect(nsVerdict('crumb.com', undefined)).toBe('unclear');
  });

  it('knows when a name resolves', () => {
    expect(resolves(answer(0, [{ name: 'x.vercel.app.', type: 1 }]))).toBe(true);
    expect(resolves(answer(3))).toBe(false);
  });
});

describe('DoH queries', () => {
  it('asks Cloudflare with the JSON accept header', async () => {
    const fetchFn = vi.fn(async () => Response.json({ Status: 3 }));
    expect(await dohNs('crumb.com', { fetchFn: fetchFn as unknown as typeof fetch })).toBe('not_found');
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://cloudflare-dns.com/dns-query?name=crumb.com&type=NS');
    expect((init.headers as Record<string, string>).accept).toBe('application/dns-json');
  });

  it('falls back to Google when Cloudflare fails or answers SERVFAIL', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ Status: 2 }))
      .mockResolvedValueOnce(Response.json({ Status: 0, Answer: [{ name: 'crumb.com.', type: 2 }] }));
    expect(await dohNs('crumb.com', { fetchFn })).toBe('registered');
    expect(String(fetchFn.mock.calls[1]![0])).toContain('https://dns.google/resolve?name=crumb.com&type=NS');

    const down = vi.fn().mockRejectedValue(new Error('offline'));
    expect(await dohQuery('crumb.com', 'NS', { fetchFn: down })).toBeUndefined();
    expect(down).toHaveBeenCalledTimes(2);
  });
});
