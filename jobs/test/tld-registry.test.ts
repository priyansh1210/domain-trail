// Spec 010 tech §11 `tld-registry.test.ts`: parsing the IANA files, validation, retired extensions, wildcard scan
// (FR-REF-001, 009).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Db, memoryDb } from '../_lib/db';
import { ianaTldList } from '../_lib/fixtures';
import { parseTldList, tldRegistry, tldType } from '../tld-registry';
import { fetchWith, one, run } from './support';

let db: Db;
beforeAll(async () => {
  db = await memoryDb();
});
afterAll(async () => {
  await db?.close();
});

describe('parseTldList', () => {
  it('reads one extension per line after the header', () => {
    const tlds = parseTldList(ianaTldList());
    expect(tlds.length).toBeGreaterThan(1000);
    expect(tlds).toContain('com');
  });

  it('rejects files that do not look like the IANA list', () => {
    expect(() => parseTldList('COM\nNET\n')).toThrow(/header/);
    expect(() => parseTldList('# header\nCOM\nNET\n')).toThrow(/only 2/);
    expect(() => parseTldList(`# h\n${Array(1200).fill('<html>').join('\n')}`)).toThrow(/format/);
  });

  it('classifies extensions', () => {
    expect([tldType('in'), tldType('shop'), tldType('co.in')]).toEqual(['ccTLD', 'gTLD', 'sld']);
  });
});

describe('tld-registry job', () => {
  it('fills tlds with the registry directory', async () => {
    const outcome = await run(tldRegistry, db, { now: new Date('2026-10-07T00:30:00Z') }); // a Wednesday
    expect(outcome.status).toBe('success');
    const com = await one<{ has_rdap: boolean; rdap_base_url: string; type: string }>(
      db,
      `select has_rdap, rdap_base_url, type from public.tlds where tld = 'com'`,
    );
    expect(com).toMatchObject({ has_rdap: true, type: 'gTLD' });
    expect(com.rdap_base_url).toMatch(/^https:\/\//);
    expect(outcome.stats).not.toHaveProperty('wildcardChecked');
  });

  it('marks extensions missing from the IANA list as retired, never deleting them', async () => {
    await db.query(`insert into public.tlds (tld, type) values ('oldext', 'gTLD')`);
    await run(tldRegistry, db);
    expect(await one(db, `select retired from public.tlds where tld = 'oldext'`)).toEqual({ retired: true });
  });

  it('gives second-level extensions their parent registry', async () => {
    await db.query(`insert into public.tlds (tld, type) values ('co.in', 'sld') on conflict do nothing`);
    await run(tldRegistry, db);
    const [sld, parent] = await db.query<{ rdap_base_url: string }>(
      `select rdap_base_url from public.tlds where tld in ('co.in', 'in') order by tld`,
    );
    expect(sld!.rdap_base_url).toBe(parent!.rdap_base_url);
  });

  it('writes nothing when a download fails validation', async () => {
    const before = await one<{ n: number }>(db, `select count(*)::int as n from public.tlds`);
    const outcome = await run(tldRegistry, db, {
      fetch: fetchWith({ 'data.iana.org': () => new Response('<html>maintenance</html>', { status: 200 }) }),
    });
    expect(outcome.status).toBe('failed');
    expect(await one(db, `select count(*)::int as n from public.tlds`)).toEqual(before);
  });

  it('on Sundays flags extensions whose name servers answer every name (FR-REF-009)', async () => {
    await db.query(`update public.tlds set priced = tld in ('com', 'shop')`);
    const wildcard = fetchWith({
      'cloudflare-dns.com': (url) => {
        const name = url.searchParams.get('name') ?? '';
        return Response.json(
          name.endsWith('.shop') ? { Status: 0, Answer: [{ name, type: 1 }] } : { Status: 3, Answer: [] },
        );
      },
    });
    const outcome = await run(tldRegistry, db, { now: new Date('2026-10-11T00:30:00Z'), fetch: wildcard });
    expect(outcome.stats).toMatchObject({ wildcardChecked: 2, wildcards: 1 });
    const rows = await db.query(
      `select tld, dns_wildcard from public.tlds where tld in ('com', 'shop') order by tld`,
    );
    expect(rows).toEqual([
      { tld: 'com', dns_wildcard: false },
      { tld: 'shop', dns_wildcard: true },
    ]);
  });
});
