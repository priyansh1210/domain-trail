// Recorded-style answers for DNS-over-HTTPS and RDAP when PUBLIC_DATA_MODE=fixture (tests, CI, local end-to-end):
// nothing goes online. About 30 % of names are "taken", decided by a hash so results never change between runs.

const KNOWN_TAKEN = new Set([
  'google',
  'amazon',
  'facebook',
  'example',
  'test',
  'bread',
  'bakery',
  'shop',
  'cloud',
]);

function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0;
  return h;
}

/** True when the fixture world says the name is registered. */
export function fixtureTaken(fqdn: string): boolean {
  const name = fqdn.toLowerCase();
  return KNOWN_TAKEN.has(name.slice(0, name.indexOf('.'))) || hash(name) % 10 < 3;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

export const fixtureFetch: typeof fetch = async (input) => {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
  if (url.hostname === 'cloudflare-dns.com' || url.hostname === 'dns.google') {
    const name = (url.searchParams.get('name') ?? '').toLowerCase();
    const type = url.searchParams.get('type') ?? 'A';
    const label = name.slice(0, name.indexOf('.'));
    if (label.length === 20 || !fixtureTaken(name)) return json({ Status: 3, Answer: [] }); // wildcard probe or free
    const record =
      type === 'NS'
        ? { name: `${name}.`, type: 2, data: 'ns1.example-dns.net.' }
        : { name: `${name}.`, type: 1, data: '192.0.2.1' };
    return json({ Status: 0, Answer: [record] });
  }
  const rdap = /\/domain\/([^/?]+)$/.exec(url.pathname);
  if (rdap) {
    const fqdn = decodeURIComponent(rdap[1]!).toLowerCase();
    return fixtureTaken(fqdn)
      ? json({ objectClassName: 'domain', ldhName: fqdn, status: ['active'], events: [] })
      : json({ errorCode: 404, title: 'Not Found' }, 404);
  }
  return json({ error: 'no fixture for this URL' }, 404);
};
