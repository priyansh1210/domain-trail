// Extensions the "Preferred extensions" box can suggest (spec 001 FR-INT-005): every extension with a registry we
// can ask (IANA's RDAP directory) plus every one our price source sells, including two-part ones like co.in.
// Built once at deploy time; the box downloads it only when a visitor starts typing.
import directory from '@domains-all/availability/data/rdap-directory.json';
import prices from '@domains-all/pricing/data/porkbun-prices.json';

export const dynamic = 'force-static';

const VALID = /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)?$/;

export function GET() {
  const tlds = new Set<string>();
  for (const n of Object.keys(directory.services)) tlds.add(n.toLowerCase());
  // Priced extensions count when their last part has a registry (drops odd keys in the price list).
  for (const n of Object.keys(prices.prices)) {
    const name = n.toLowerCase();
    if (tlds.has(name.split('.').pop()!)) tlds.add(name);
  }
  const list = [...tlds].filter((t) => VALID.test(t) && !t.startsWith('xn--')).sort();
  return Response.json(list, { headers: { 'cache-control': 'public, max-age=86400' } });
}
