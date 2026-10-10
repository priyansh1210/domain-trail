// Health report for uptime monitoring (spec 015 tech §4, OpenAPI `/health`). No secrets or internal host
// names are ever included.
import { observability, type ServerEnv } from '@domains-all/config';

export type DependencyState = 'ok' | 'down';

export interface Health {
  ok: boolean;
  db: DependencyState;
  upstash: DependencyState;
  jevBreaker: 'closed' | 'open';
  version: string;
  mode: 'live' | 'mock';
  /** Freshness of the public data the server reads (spec 006 FR-PRC-011, spec 009 FR-UX-011). */
  data?: HealthData;
}

export interface HealthData {
  pricesAt: string;
  fxAsOf: string;
  publicData: 'live' | 'fixture';
  priceRefresh: 'ok' | 'failed' | 'not_yet';
  /** Where the prices in use came from: the daily job's database tables, Porkbun directly, or the snapshot. */
  pricesSource?: 'database' | 'porkbun' | 'snapshot';
  /** Short reason when the last refresh failed (no secrets: only the public URL and status). */
  priceRefreshNote?: string;
  rdapDirectory: string;
}

type FetchFn = typeof fetch;

async function probe(
  fetchFn: FetchFn,
  url: string,
  headers: Record<string, string>,
): Promise<Response | null> {
  try {
    return await fetchFn(url, {
      headers,
      cache: 'no-store',
      signal: AbortSignal.timeout(observability.healthDependencyTimeoutMs),
    });
  } catch {
    return null;
  }
}

export async function checkDb(env: ServerEnv, fetchFn: FetchFn = fetch): Promise<DependencyState> {
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return 'down';
  // `tlds` is public reference data (spec 012 §4), so the anon key can read it under RLS.
  const res = await probe(fetchFn, new URL('/rest/v1/tlds?select=tld&limit=1', url).toString(), {
    apikey: key,
    Authorization: `Bearer ${key}`,
  });
  return res?.ok ? 'ok' : 'down';
}

export async function checkUpstash(env: ServerEnv, fetchFn: FetchFn = fetch): Promise<DependencyState> {
  const url = env.UPSTASH_REDIS_REST_URL;
  const token = env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return 'down';
  const res = await probe(fetchFn, new URL('/ping', url).toString(), { Authorization: `Bearer ${token}` });
  if (!res?.ok) return 'down';
  const body = (await res.json().catch(() => null)) as { result?: string } | null;
  return body?.result === 'PONG' ? 'ok' : 'down';
}

export async function computeHealth(
  env: ServerEnv,
  fetchFn: FetchFn = fetch,
  jevBreaker: 'closed' | 'open' = 'closed',
  data?: HealthData,
): Promise<Health> {
  const version = env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12) ?? 'local';
  const extra = data ? { data } : {};
  if (env.MOCK_EXTERNALS) {
    // Mock mode uses in-process fixtures for paid dependencies (spec 016 FR-QA-003).
    return { ok: true, db: 'ok', upstash: 'ok', jevBreaker, version, mode: 'mock', ...extra };
  }
  const [db, upstash] = await Promise.all([checkDb(env, fetchFn), checkUpstash(env, fetchFn)]);
  return { ok: db === 'ok' && upstash === 'ok', db, upstash, jevBreaker, version, mode: 'live', ...extra };
}

/** Per-instance cache so monitors and bursts cost at most one probe per 30 s. */
export function cachedHealth(compute: () => Promise<Health>, now: () => number = Date.now) {
  let entry: { value: Health; expires: number } | undefined;
  return async (): Promise<Health> => {
    if (entry && entry.expires > now()) return entry.value;
    const value = await compute();
    entry = { value, expires: now() + observability.healthCacheSeconds * 1000 };
    return value;
  };
}
