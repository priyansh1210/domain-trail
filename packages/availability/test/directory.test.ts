// RDAP directory (spec 005 tech §5.2, research R-03): parsing the IANA bootstrap, refreshing inside a request, and
// retrying 10 minutes after a failure (serverless hosts freeze background work, 2026-10-04).
import { describe, expect, it, vi } from 'vitest';
import { createDirectorySource, RdapDirectory } from '../src/directory';

const bootstrap = (n = 600) => ({
  publication: '2026-10-04T00:00:00Z',
  services: [
    [['com', 'net'], ['https://rdap.verisign.com/com/v1/']],
    [['in'], ['https://rdap.nixiregistry.in/rdap']],
    ...Array.from({ length: n }, (_, i) => [[`t${i}`], [`https://rdap.example/${i}/`]]),
  ],
});

describe('RDAP directory', () => {
  it('maps extensions to registry URLs, second-level extensions to their parent', () => {
    const d = RdapDirectory.fromIana(bootstrap());
    expect(d.baseFor('com')).toBe('https://rdap.verisign.com/com/v1/');
    expect(d.baseFor('co.in')).toBe('https://rdap.nixiregistry.in/rdap/');
    expect(d.baseFor('io')).toBeUndefined();
    expect(() => RdapDirectory.fromIana(bootstrap(10))).toThrow(); // looks incomplete
  });

  it('refreshes inside the request and retries 10 minutes after a failure', async () => {
    let now = 0;
    let up = false;
    const fetchFn = vi.fn(async () => (up ? Response.json(bootstrap()) : new Response('', { status: 500 })));
    const source = createDirectorySource({
      live: true,
      fetchFn: fetchFn as unknown as typeof fetch,
      now: () => now,
    });
    await source.ensureFresh(1000);
    expect(source.refreshedAt()).toBeUndefined();
    up = true;
    now += 5 * 60_000;
    await source.ensureFresh(1000);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    now += 6 * 60_000;
    const d = await source.ensureFresh(1000);
    expect(d.publication).toBe('2026-10-04T00:00:00Z');
    expect(source.refreshedAt()).toBeDefined();
  });

  it('never goes online in fixture mode', async () => {
    const fetchFn = vi.fn();
    await createDirectorySource({ live: false, fetchFn: fetchFn as unknown as typeof fetch }).ensureFresh(
      100,
    );
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
