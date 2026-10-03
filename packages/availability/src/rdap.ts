// Authoritative registry answer over RDAP (spec 005 tech §5.2; FR-AVL-001, 003, 007). Only status and dates are
// read — registrant data is never stored (tech §9). Responses are size-limited and parsed defensively.
import { availability } from '@domains-all/config/defaults';

export type RdapStatus = 'available' | 'taken' | 'dropping_soon' | 'unknown';

export interface RdapOutcome {
  status: RdapStatus;
  /** HTTP status, or undefined for network errors and timeouts. */
  httpStatus?: number;
  /** Set when the registry asked us to slow down (429). */
  rateLimited?: boolean;
  /** Expiration date from the record, used for the "dropping soon" window. */
  expiration?: string;
}

export interface RdapOptions {
  fetchFn?: typeof fetch;
  userAgent: string;
  timeoutMs?: number;
  maxBytes?: number;
  sleep?: (ms: number) => Promise<void>;
  /** Called once per HTTP request (politeness accounting). */
  onRequest?: () => void;
}

const DROPPING = ['pending delete', 'redemption period'];

async function readLimited(res: Response, maxBytes: number): Promise<string | undefined> {
  const declared = Number(res.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) return undefined;
  const text = await res.text();
  return text.length > maxBytes ? undefined : text;
}

/** Classifies a 200 response: dropping soon when the registry says it is being deleted, otherwise taken. */
export function classifyRecord(text: string | undefined): {
  status: 'taken' | 'dropping_soon';
  expiration?: string;
} {
  if (!text) return { status: 'taken' };
  try {
    const json = JSON.parse(text) as { status?: unknown; events?: unknown };
    const statuses = Array.isArray(json.status) ? json.status.map((s) => String(s).toLowerCase()) : [];
    const expiration = Array.isArray(json.events)
      ? (json.events as Array<{ eventAction?: unknown; eventDate?: unknown }>).find(
          (e) => String(e.eventAction).toLowerCase() === 'expiration',
        )?.eventDate
      : undefined;
    const exp = typeof expiration === 'string' ? expiration : undefined;
    return DROPPING.some((d) => statuses.includes(d))
      ? { status: 'dropping_soon', ...(exp ? { expiration: exp } : {}) }
      : { status: 'taken', ...(exp ? { expiration: exp } : {}) };
  } catch {
    return { status: 'taken' }; // a 200 means the record exists, even if the body is odd
  }
}

export async function rdapLookup(fqdn: string, baseUrl: string, opts: RdapOptions): Promise<RdapOutcome> {
  const sleep = opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const url = `${baseUrl}domain/${encodeURIComponent(fqdn)}`;
  for (let attempt = 0; attempt < 2; attempt++) {
    opts.onRequest?.();
    let res: Response;
    try {
      res = await (opts.fetchFn ?? fetch)(url, {
        headers: { accept: 'application/rdap+json, application/json', 'user-agent': opts.userAgent },
        redirect: 'follow',
        signal: AbortSignal.timeout(opts.timeoutMs ?? availability.rdapTimeoutMs),
      });
    } catch {
      if (attempt === 0) {
        await sleep(500);
        continue;
      }
      return { status: 'unknown' };
    }
    if (res.status === 404) return { status: 'available', httpStatus: 404 };
    if (res.ok) {
      const record = classifyRecord(await readLimited(res, opts.maxBytes ?? availability.rdapMaxBytes));
      return { ...record, httpStatus: res.status };
    }
    if (res.status === 429) {
      const wait = Number(res.headers.get('retry-after'));
      if (attempt === 0 && Number.isFinite(wait) && wait <= availability.rdapRetryAfterMaxSeconds) {
        await sleep(Math.max(0, wait) * 1000);
        continue;
      }
      return { status: 'unknown', httpStatus: 429, rateLimited: true };
    }
    if (res.status >= 500 && attempt === 0) {
      await sleep(500);
      continue;
    }
    return { status: 'unknown', httpStatus: res.status };
  }
  return { status: 'unknown' };
}
