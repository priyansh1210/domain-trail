// Recorded or generated answers for every source the jobs read (spec 010 tech §11 dry-run mode). Built from the
// committed snapshots where possible, so a dry run exercises the real parsers and validation without network access.
import directory from '@domains-all/availability/data/rdap-directory.json';
import fx from '@domains-all/pricing/data/fx-rates.json';
import prices from '@domains-all/pricing/data/porkbun-prices.json';
import { strToU8, zipSync } from 'fflate';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const text = (body: string | Uint8Array, type = 'text/plain') =>
  new Response(body, { status: 200, headers: { 'content-type': type } });

/** Small deterministic PRNG (mulberry32) for generated fixtures. */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Invented, pronounceable site names ("zorvan", "kelimo"): not dictionary words. */
export function coinedLabels(count: number, seed = 7): string[] {
  const rand = rng(seed);
  const c = 'bdfgklmnprstvz';
  const v = 'aeiou';
  const pick = (s: string) => s[Math.floor(rand() * s.length)]!;
  const out = new Set<string>();
  while (out.size < count) {
    const syllables = 2 + Math.floor(rand() * 2);
    let w = '';
    for (let i = 0; i < syllables; i++) w += pick(c) + pick(v);
    out.add(`${w}${pick(c)}`);
  }
  return [...out];
}

/** Every extension the snapshots know: the RDAP directory plus priced extensions without RDAP (.io, .co, .me). */
export function ianaTldList(): string {
  const known = [...Object.keys(directory.services), ...Object.keys(prices.prices)];
  const tlds = [...new Set(known.filter((t) => /^[a-z][a-z0-9-]{1,62}$/.test(t)))];
  return `# Version 2026101000, Last Updated Sat Oct 10 07:07:01 2026 UTC\n${tlds.map((t) => t.toUpperCase()).join('\n')}\n`;
}

export function ianaBootstrap() {
  const byUrl = new Map<string, string[]>();
  for (const [tld, url] of Object.entries(directory.services as Record<string, string>))
    byUrl.set(url, [...(byUrl.get(url) ?? []), tld]);
  return {
    version: '1.0',
    publication: directory.publication,
    services: [...byUrl].map(([url, tlds]) => [tlds, [url]]),
  };
}

export function porkbunPricing() {
  const pricing: Record<string, { registration: string; renewal: string; transfer: string }> = {};
  for (const [tld, [reg, ren]] of Object.entries(
    prices.prices as unknown as Record<string, [number, number]>,
  ))
    pricing[tld] = {
      registration: (reg / 100).toFixed(2),
      renewal: (ren / 100).toFixed(2),
      transfer: '0.00',
    };
  return { status: 'SUCCESS', pricing };
}

export function frankfurter() {
  const { USD: _usd, ...rates } = fx.rates as Record<string, number>;
  return { amount: 1, base: 'USD', date: fx.asOf, rates };
}

/** A whoisds-style zip: `domain-names.txt` with one name per line. */
export function nrdZip(names: readonly string[]): Uint8Array {
  return zipSync({ 'domain-names.txt': strToU8(`${names.join('\r\n')}\r\n`) });
}

export function nrdNames(count = 1500): string[] {
  const words = [
    'sunny',
    'crust',
    'bakery',
    'cloud',
    'tech',
    'shop',
    'green',
    'home',
    'pet',
    'studio',
    'travel',
  ];
  const tlds = ['com', 'shop', 'online', 'xyz', 'in', 'store'];
  const rand = rng(11);
  const out = new Set<string>();
  while (out.size < count) {
    const a = words[Math.floor(rand() * words.length)]!;
    const b = words[Math.floor(rand() * words.length)]!;
    const n = Math.floor(rand() * 1000);
    out.add(`${a}${b}${n % 3 === 0 ? '' : n}.${tlds[n % tlds.length]}`);
  }
  return [...out];
}

export function majesticCsv(rows = 13_000): string {
  const header =
    'GlobalRank,TldRank,Domain,TLD,RefSubNets,RefIPs,IDN_Domain,IDN_TLD,PrevGlobalRank,PrevTldRank,PrevRefSubNets,PrevRefIPs';
  const labels = coinedLabels(rows);
  const lines = labels.map(
    (l, i) => `${i + 1},${i + 1},${l}.com,com,100,100,${l}.com,com,${i + 1},${i + 1},100,100`,
  );
  // Ordinary words and word compounds are filtered out by the job.
  lines.unshift(
    '1,1,zomato.com,com,1,1,zomato.com,com,1,1,1,1',
    '2,2,bookstore.com,com,1,1,bookstore.com,com,2,2,1,1',
  );
  return [header, ...lines].join('\n');
}

const githubTree = () => ({
  sha: 'fixture',
  tree: coinedLabels(150, 3).map((l) => ({ path: `domains/${l}.json`, type: 'blob' })),
  truncated: false,
});
const jsOrgList = () =>
  `var cnames_active = {\n${coinedLabels(150, 5)
    .map((l) => `  "${l}": "${l}.github.io",`)
    .join('\n')}\n}\n`;

/** DNS-over-HTTPS answers: name servers exist for every suffix asked about; random names do not exist. */
function doh(url: URL): Response {
  const name = url.searchParams.get('name') ?? '';
  const type = url.searchParams.get('type') ?? 'A';
  if (type === 'NS') return json({ Status: 0, Answer: [{ name, type: 2, data: `ns1.${name}.` }] });
  return json({ Status: 3, Answer: [] });
}

export const fixtureFetch: typeof fetch = async (input) => {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
  if (url.host === 'data.iana.org' && url.pathname.endsWith('tlds-alpha-by-domain.txt'))
    return text(ianaTldList());
  if (url.host === 'data.iana.org' && url.pathname.endsWith('dns.json')) return json(ianaBootstrap());
  if (url.host === 'api.porkbun.com') return json(porkbunPricing());
  if (url.host === 'api.frankfurter.dev') return json(frankfurter());
  if (url.host === 'www.whoisds.com') return text(nrdZip(nrdNames()), 'application/octet-stream');
  if (url.host === 'downloads.majestic.com') return text(majesticCsv(), 'text/csv');
  if (url.host === 'api.github.com') return json(githubTree());
  if (url.host === 'raw.githubusercontent.com') return text(jsOrgList(), 'application/javascript');
  if (url.host === 'cloudflare-dns.com' || url.host === 'dns.google') return doh(url);
  if (url.protocol === 'https:' && url.host !== 'api.resend.com')
    return text('<!doctype html><title>ok</title>', 'text/html');
  return new Response('not found', { status: 404 });
};
