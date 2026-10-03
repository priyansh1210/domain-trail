// Free results (spec 007 tech §5.3, §5.5; FR-FREE-004, 006, 007, 011): checked names per provider, scored by
// relevance, provider fit and check confidence; top 15, at most 5 per provider. Labels come from the ranked,
// safety-filtered candidates (FR-FREE-006).
import { ranking } from '@domains-all/config/defaults';
import type { FreeChecker, FreeStatus } from './check';
import type { FreeProvider, ProviderKind } from './providers';

export interface FreeLabel {
  label: string;
  /** 0–1 relevance from the ranking (spec 008). */
  relevance: number;
}

export interface FreeResult {
  fqdn: string;
  label: string;
  providerId: string;
  providerName: string;
  kind: ProviderKind;
  status: Exclude<FreeStatus, 'taken'>;
  checkedAt: string;
  conditions: { steps: string[]; waitTime: string; eligibility: string; url: string };
  score: number;
}

const MAX_PER_PROVIDER = 5;

/** Specific matches (e.g. is-a.dev for developers) fit best; long manual waits fit least. */
function providerFit(p: FreeProvider): number {
  if (p.kind === 'platform_address') return 0.7;
  if (p.kind === 'community_registry') return 0.5;
  return 1;
}

const VALID_SUBDOMAIN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

export async function findFreeNames(opts: {
  labels: readonly FreeLabel[];
  providers: readonly FreeProvider[];
  checker: FreeChecker;
  now?: () => number;
  /** Check at most this many labels per provider (DoH budget, spec 007 §10). */
  perProvider?: number;
}): Promise<FreeResult[]> {
  const now = opts.now ?? Date.now;
  const per = opts.perProvider ?? 8;
  const checks = opts.providers.flatMap((p) =>
    opts.labels
      .filter((l) => VALID_SUBDOMAIN.test(l.label) && (p.kind === 'platform_address' || !l.label.includes('-')))
      .slice(0, per)
      .map(async (l) => {
        const status = await opts.checker.check(l.label, p).catch(() => 'not_verifiable' as const);
        if (status === 'taken') return undefined;
        const confidence = status === 'appears_free' ? 1 : 0.4;
        const result: FreeResult = {
          fqdn: `${l.label}.${p.suffix}`,
          label: l.label,
          providerId: p.id,
          providerName: p.name,
          kind: p.kind,
          status,
          checkedAt: new Date(now()).toISOString(),
          conditions: {
            steps: p.steps.map((s) => s.replaceAll('{label}', l.label)),
            waitTime: p.waitTime,
            eligibility: p.eligibility.note,
            url: p.officialUrl,
          },
          score: 0.6 * l.relevance + 0.25 * providerFit(p) + 0.15 * confidence,
        };
        return result;
      }),
  );
  const found = (await Promise.all(checks)).filter((r): r is FreeResult => !!r);
  found.sort((a, b) => b.score - a.score || a.fqdn.localeCompare(b.fqdn));
  const perCount = new Map<string, number>();
  const out: FreeResult[] = [];
  for (const r of found) {
    const n = perCount.get(r.providerId) ?? 0;
    if (n >= MAX_PER_PROVIDER) continue;
    perCount.set(r.providerId, n + 1);
    out.push(r);
    if (out.length >= ranking.freeResultsMax) break;
  }
  return out;
}
