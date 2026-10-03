// DNS-over-HTTPS pre-check (spec 005 tech §5.1, FR-AVL-002): a name with NS records is registered; anything else
// goes on to the registry's RDAP answer. Cloudflare first, Google as the fallback.
import { availability } from '@domains-all/config/defaults';
import { timedFetch } from '@domains-all/config/net';

export const DOH_PROVIDERS = [
  (name: string, type: string) =>
    `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=${type}`,
  (name: string, type: string) => `https://dns.google/resolve?name=${encodeURIComponent(name)}&type=${type}`,
] as const;

const TYPE_CODE: Record<string, number> = { A: 1, NS: 2, CNAME: 5, SOA: 6, AAAA: 28 };

export interface DohAnswer {
  /** DNS RCODE: 0 NOERROR, 2 SERVFAIL, 3 NXDOMAIN. */
  status: number;
  answer: Array<{ name: string; type: number }>;
  authority: Array<{ name: string; type: number }>;
}

export interface DohOptions {
  fetchFn?: typeof fetch;
  timeoutMs?: number;
}

/** One query against one provider; undefined on network error, timeout or a non-JSON answer. */
async function queryOnce(url: string, opts: DohOptions): Promise<DohAnswer | undefined> {
  const res = await timedFetch(url, {
    headers: { accept: 'application/dns-json' },
    timeoutMs: opts.timeoutMs ?? availability.dohTimeoutMs,
    maxBytes: 64 * 1024,
    fetchFn: opts.fetchFn,
  });
  if (!res?.ok || res.text === undefined) return undefined;
  try {
    const json = JSON.parse(res.text) as { Status?: unknown; Answer?: unknown; Authority?: unknown };
    if (typeof json.Status !== 'number') return undefined;
    const records = (v: unknown) =>
      Array.isArray(v)
        ? v.map((r) => ({
            name: String((r as { name?: unknown }).name ?? ''),
            type: Number((r as { type?: unknown }).type),
          }))
        : [];
    return { status: json.Status, answer: records(json.Answer), authority: records(json.Authority) };
  } catch {
    return undefined;
  }
}

/** Queries Cloudflare, then Google if the first answer is missing or a SERVFAIL. */
export async function dohQuery(
  name: string,
  type: keyof typeof TYPE_CODE,
  opts: DohOptions = {},
): Promise<DohAnswer | undefined> {
  let last: DohAnswer | undefined;
  for (const provider of DOH_PROVIDERS) {
    last = await queryOnce(provider(name, type), opts);
    if (last && last.status !== 2) return last;
  }
  return last;
}

export type NsVerdict = 'registered' | 'not_found' | 'unclear';

const sameName = (a: string, b: string) =>
  a.toLowerCase().replace(/\.$/, '') === b.toLowerCase().replace(/\.$/, '');

/** NS records for the name itself ⇒ registered; NXDOMAIN ⇒ not found; anything else is left to RDAP. */
export function nsVerdict(fqdn: string, answer: DohAnswer | undefined): NsVerdict {
  if (!answer) return 'unclear';
  if (answer.status === 3) return 'not_found';
  if (answer.status !== 0) return 'unclear';
  const hasNs = [...answer.answer, ...answer.authority].some(
    (r) => r.type === TYPE_CODE.NS && sameName(r.name, fqdn),
  );
  return hasNs ? 'registered' : 'unclear';
}

export async function dohNs(fqdn: string, opts: DohOptions = {}): Promise<NsVerdict> {
  return nsVerdict(fqdn, await dohQuery(fqdn, 'NS', opts));
}

/** True when the name has any A/AAAA/CNAME answer (used for wildcard detection and hosting-address checks). */
export function resolves(answer: DohAnswer | undefined): boolean {
  return !!answer && answer.status === 0 && answer.answer.some((r) => [1, 5, 28].includes(r.type));
}
