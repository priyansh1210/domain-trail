// Which registry answers RDAP for an extension (spec 005 tech §5.2, research R-03). The IANA bootstrap file lists
// one base URL per TLD; second-level extensions (`co.in`, `com.au`) are answered by their parent's registry.
import { availability } from '@domains-all/config/defaults';
import { timedFetch } from '@domains-all/config/net';
import snapshot from '../data/rdap-directory.json';

export const IANA_RDAP_URL = 'https://data.iana.org/rdap/dns.json';

export class RdapDirectory {
  constructor(
    private readonly services: Readonly<Record<string, string>>,
    readonly publication: string,
  ) {}

  /** Base URL ending in "/" for the extension, or undefined when its registry has no RDAP. */
  baseFor(tld: string): string | undefined {
    const t = tld.toLowerCase();
    return this.services[t] ?? this.services[t.slice(t.lastIndexOf('.') + 1)];
  }

  get size(): number {
    return Object.keys(this.services).length;
  }

  static fromSnapshot(): RdapDirectory {
    return new RdapDirectory(snapshot.services as Record<string, string>, snapshot.publication);
  }

  /** Parses the IANA bootstrap JSON (`{ publication, services: [[tlds], [urls]][] }`). */
  static fromIana(json: unknown): RdapDirectory {
    const data = json as { publication?: unknown; services?: unknown };
    if (!Array.isArray(data.services)) throw new Error('not an RDAP bootstrap file');
    const services: Record<string, string> = {};
    for (const entry of data.services as unknown[]) {
      const [tlds, urls] = entry as [unknown, unknown];
      if (!Array.isArray(tlds) || !Array.isArray(urls)) continue;
      const url = (urls as string[]).find((u) => u.startsWith('https://')) ?? (urls[0] as string | undefined);
      if (!url) continue;
      for (const tld of tlds as string[]) services[tld.toLowerCase()] = url.endsWith('/') ? url : `${url}/`;
    }
    if (Object.keys(services).length < 500) throw new Error('RDAP bootstrap file looks incomplete');
    return new RdapDirectory(services, String(data.publication ?? ''));
  }
}

/**
 * Serves the directory without delaying searches: the committed snapshot answers at once, and in live mode a fresh
 * copy is fetched in the background at most every `directoryRefreshHours`.
 */
export function createDirectorySource(opts: { live: boolean; fetchFn?: typeof fetch; now?: () => number }) {
  const now = opts.now ?? Date.now;
  let current = RdapDirectory.fromSnapshot();
  let fetchedAt = opts.live ? 0 : Number.POSITIVE_INFINITY;
  let inFlight: Promise<void> | undefined;
  const maxAge = availability.directoryRefreshHours * 3600_000;

  function refresh(): void {
    if (inFlight || now() - fetchedAt < maxAge) return;
    fetchedAt = now(); // one attempt per window, even if it fails
    inFlight = timedFetch(IANA_RDAP_URL, { timeoutMs: 10_000, maxBytes: 2_000_000, fetchFn: opts.fetchFn })
      .then((res) => {
        if (res?.ok && res.text) current = RdapDirectory.fromIana(JSON.parse(res.text));
      })
      .catch(() => undefined) // keep the previous copy
      .finally(() => {
        inFlight = undefined;
      });
  }

  return {
    get(): RdapDirectory {
      refresh();
      return current;
    },
    /** For tests: waits for a background refresh, if one is running. */
    settled: () => inFlight ?? Promise.resolve(),
  };
}

export type DirectorySource = ReturnType<typeof createDirectorySource>;
