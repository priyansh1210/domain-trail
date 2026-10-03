// Saves dated snapshots of the free public data the app reads at run time (tasks/M4-verify.md B1, B3):
//   packages/availability/data/rdap-directory.json  — IANA RDAP bootstrap (TLD → registry RDAP base URL)
//   packages/pricing/data/porkbun-prices.json       — Porkbun public price list (USD cents)
//   packages/pricing/data/fx-rates.json             — Frankfurter (ECB) rates, base USD
// The server refreshes the same data every 12 hours; these files are the offline fallback and the test fixtures.
// Run: node scripts/snapshot-public-data.mjs
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const get = async (url, init) => {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  return res.json();
};
const cents = (usd) => Math.round(Number(usd) * 100);
const write = (path, data) => {
  writeFileSync(join(root, path), `${JSON.stringify(data, null, 0)}\n`);
  console.log(`wrote ${path}`);
};

const iana = await get('https://data.iana.org/rdap/dns.json');
const services = {};
for (const [tlds, urls] of iana.services) {
  const url = urls.find((u) => u.startsWith('https://')) ?? urls[0];
  for (const tld of tlds) services[tld.toLowerCase()] = url.endsWith('/') ? url : `${url}/`;
}
write('packages/availability/data/rdap-directory.json', {
  source: 'https://data.iana.org/rdap/dns.json',
  publication: iana.publication,
  services,
});

const porkbun = await get('https://api.porkbun.com/api/json/v3/pricing/get');
if (porkbun.status !== 'SUCCESS') throw new Error('Porkbun pricing failed');
const prices = {};
for (const [tld, p] of Object.entries(porkbun.pricing)) {
  const reg = cents(p.registration);
  const renew = cents(p.renewal);
  if (Number.isFinite(reg) && Number.isFinite(renew)) prices[tld.toLowerCase()] = [reg, renew];
}
write('packages/pricing/data/porkbun-prices.json', {
  source: 'https://api.porkbun.com/api/json/v3/pricing/get',
  fetchedAt: new Date().toISOString(),
  currency: 'USD',
  prices,
});

const fx = await get('https://api.frankfurter.dev/v1/latest?base=USD');
write('packages/pricing/data/fx-rates.json', {
  source: 'https://api.frankfurter.dev/v1/latest?base=USD',
  base: 'USD',
  asOf: fx.date,
  rates: { USD: 1, ...fx.rates },
});
