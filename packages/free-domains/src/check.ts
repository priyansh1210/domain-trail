// Free-name checks (spec 007 tech §5.4; FR-FREE-003, FR-FREE-010). Only permitted methods: public GitHub lists of
// taken names (fetched at most every 12 hours per server), a DNS lookup where the suffix has no wildcard, or
// "not verifiable". Research R-08 lists which provider uses which.
import { availability } from '@domains-all/config/defaults';
import { dohQuery, fixtureTaken, nsVerdict, resolves } from '@domains-all/availability';
import type { FreeProvider } from './providers';

export type FreeStatus = 'appears_free' | 'taken' | 'not_verifiable';

/** Parses a repository tree (`domains/<label>.json`) or a JS object of `"label": "target"` pairs. */
export function parseTakenList(format: 'tree' | 'js_keys', body: string, cfg: { prefix?: string; ext?: string } = {}): Set<string> {
  const out = new Set<string>();
  if (format === 'tree') {
    const json = JSON.parse(body) as { tree?: Array<{ path?: unknown }> };
    const prefix = cfg.prefix ?? '';
    const ext = cfg.ext ?? '';
    for (const entry of json.tree ?? []) {
      const path = String(entry.path ?? '');
      if (path.startsWith(prefix) && path.endsWith(ext) && !path.slice(prefix.length).includes('/'))
        out.add(path.slice(prefix.length, path.length - ext.length).toLowerCase());
    }
  } else {
    for (const m of body.matchAll(/^\s*"([a-z0-9-]+)"\s*:/gm)) out.add(m[1]!.toLowerCase());
  }
  return out;
}

export function createFreeChecker(opts: { live: boolean; fetchFn?: typeof fetch; now?: () => number }) {
  const now = opts.now ?? Date.now;
  const lists = new Map<string, { taken?: Set<string>; at: number; loading?: Promise<Set<string> | undefined> }>();
  const maxAge = availability.directoryRefreshHours * 3600_000;

  async function takenList(p: FreeProvider): Promise<Set<string> | undefined> {
    const cfg = p.checkConfig;
    if (!cfg?.url || !cfg.format) return undefined;
    const entry = lists.get(p.id);
    if (entry?.taken && now() - entry.at < maxAge) return entry.taken;
    if (entry?.loading) return entry.loading;
    const loading = (opts.fetchFn ?? fetch)(cfg.url, {
      headers: { accept: cfg.format === 'tree' ? 'application/vnd.github+json' : 'text/plain' },
      signal: AbortSignal.timeout(8000),
    })
      .then(async (res) => (res.ok ? parseTakenList(cfg.format!, await res.text(), cfg) : undefined))
      .catch(() => undefined);
    lists.set(p.id, { ...entry, at: entry?.at ?? 0, loading });
    const taken = await loading;
    // A failed download keeps the previous list (spec 007 §8); the next attempt waits for the next window.
    lists.set(p.id, { taken: taken ?? entry?.taken, at: now() });
    return taken ?? entry?.taken;
  }

  async function check(label: string, p: FreeProvider): Promise<FreeStatus> {
    const fqdn = `${label}.${p.suffix}`;
    if (p.checkMethod === 'none') return 'not_verifiable';
    if (!opts.live) return fixtureTaken(fqdn) ? 'taken' : 'appears_free';
    if (p.checkMethod === 'github_list') {
      const taken = await takenList(p);
      if (!taken) return 'not_verifiable';
      return taken.has(label) ? 'taken' : 'appears_free';
    }
    const type = p.checkConfig?.type ?? 'NS';
    const answer = await dohQuery(fqdn, type, { fetchFn: opts.fetchFn });
    if (!answer) return 'not_verifiable';
    if (type === 'NS') {
      const verdict = nsVerdict(fqdn, answer);
      return verdict === 'registered' ? 'taken' : verdict === 'not_found' ? 'appears_free' : 'not_verifiable';
    }
    return resolves(answer) ? 'taken' : answer.status === 3 ? 'appears_free' : 'not_verifiable';
  }

  return { check };
}

export type FreeChecker = ReturnType<typeof createFreeChecker>;
