// Status report (spec 009 FR-UX-011, spec 010 FR-REF-015, OpenAPI `Status`): how old each dataset is and whether
// the parts of a search work. Job times come from `public_job_status()` — names and times only — read with the
// public key; without a database the report shows what this server knows itself.
import { jevKey } from '@domains-all/config';
import { jobs as jobCfg } from '@domains-all/config/defaults';
import { timedFetch } from '@domains-all/config/net';
import type { Services } from './services';

export type Dataset = 'prices' | 'fx' | 'tlds' | 'nrd' | 'freeProviders' | 'brandList';
export const DATASETS: readonly Dataset[] = ['prices', 'fx', 'tlds', 'nrd', 'freeProviders', 'brandList'];

export interface JobStatus {
  job: string;
  lastSuccessAt: string | null;
  lastStatus: string | null;
  failuresInRow: number;
}

export interface StatusReport {
  generatedAt: string;
  /** Hours since the last refresh, one decimal; null = not refreshed yet. */
  dataAges: Record<Dataset, number | null>;
  /** Datasets older than their limit (30 h for daily data). */
  stale: Dataset[];
  services: {
    search: 'ok' | 'degraded' | 'down';
    decisionModel: 'ok' | 'degraded' | 'budget_exhausted';
    availability: 'ok' | 'degraded' | 'paused';
  };
  jobs: JobStatus[];
}

const JOB_OF: Partial<Record<Dataset, string>> = {
  tlds: 'tld-registry',
  nrd: 'nrd-ingest',
  freeProviders: 'refresh-free-providers',
  brandList: 'brand-list',
};

/** Hours a dataset may age before it is highlighted. ECB rates skip weekends; the brand list is weekly. */
export const STALE_AFTER_HOURS: Record<Dataset, number> = {
  prices: jobCfg.staleAfterHours.daily,
  fx: 4 * 24,
  tlds: jobCfg.staleAfterHours.daily,
  nrd: jobCfg.staleAfterHours.daily,
  freeProviders: jobCfg.staleAfterHours.daily,
  brandList: jobCfg.staleAfterHours.weekly,
};

export async function readJobStatus(
  url: string | undefined,
  key: string | undefined,
  fetchFn: typeof fetch = fetch,
): Promise<JobStatus[]> {
  if (!url || !key) return [];
  const res = await timedFetch(new URL('/rest/v1/rpc/public_job_status', url).toString(), {
    method: 'POST',
    headers: { apikey: key, authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: '{}',
    timeoutMs: 3000,
    maxBytes: 100_000,
    fetchFn,
  });
  if (!res?.ok || !res.text) return [];
  const rows = JSON.parse(res.text) as Array<{
    job: string;
    last_success_at: string | null;
    last_status: string | null;
    failures_in_row: number;
  }>;
  return rows.map((r) => ({
    job: r.job,
    lastSuccessAt: r.last_success_at,
    lastStatus: r.last_status,
    failuresInRow: r.failures_in_row,
  }));
}

const hoursSince = (iso: string | null | undefined, now: number) =>
  iso ? Math.max(0, Math.round(((now - Date.parse(iso)) / 3600_000) * 10) / 10) : null;

export function buildStatus(input: {
  now: number;
  pricesAt: string;
  fxAsOf: string;
  rdapRefreshedAt?: string;
  jobs: JobStatus[];
  decisionModel: StatusReport['services']['decisionModel'];
}): StatusReport {
  const { now, jobs } = input;
  const success = (job: string) => jobs.find((j) => j.job === job)?.lastSuccessAt ?? null;
  const tldsAt = [success('tld-registry'), input.rdapRefreshedAt ?? null]
    .filter((v): v is string => !!v)
    .sort()
    .at(-1);
  const dataAges: Record<Dataset, number | null> = {
    prices: hoursSince(input.pricesAt, now),
    fx: hoursSince(`${input.fxAsOf}T16:00:00Z`, now), // ECB reference rates are set mid-afternoon CET
    tlds: hoursSince(tldsAt, now),
    nrd: hoursSince(success(JOB_OF.nrd!), now),
    freeProviders: hoursSince(success(JOB_OF.freeProviders!), now),
    brandList: hoursSince(success(JOB_OF.brandList!), now),
  };
  const stale = DATASETS.filter((d) => {
    const age = dataAges[d];
    // A dataset whose job has never run is "not refreshed yet", not stale (it may simply not be set up).
    return age !== null && age > STALE_AFTER_HOURS[d];
  });
  const availability: StatusReport['services']['availability'] = 'ok';
  return {
    generatedAt: new Date(now).toISOString(),
    dataAges,
    stale,
    services: {
      search:
        input.decisionModel === 'ok' && availability === 'ok' && !stale.includes('prices')
          ? 'ok'
          : 'degraded',
      decisionModel: input.decisionModel,
      availability,
    },
    jobs,
  };
}

/** Status for this server instance, cached for a minute (the page and API are cached for 5 minutes on top). */
export function statusSource(svc: Services, fetchFn: typeof fetch = fetch, now: () => number = Date.now) {
  let cached: { at: number; value: StatusReport } | undefined;
  return async (): Promise<StatusReport> => {
    if (cached && now() - cached.at < 60_000) return cached.value;
    const env = svc.env;
    await svc.refreshPublicData(2000);
    const live = env.PUBLIC_DATA_MODE === 'live';
    const jobs = live
      ? await readJobStatus(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, fetchFn).catch(
          () => [],
        )
      : [];
    const p = svc.prices.status();
    // Mock mode answers with a stand-in for the decision model, so the real one is not connected; without a key or
    // with the circuit breaker open, searches use the deterministic fallback (spec 002).
    const connected = !env.MOCK_EXTERNALS && !!jevKey(env)[1] && svc.jev.breakerState() === 'closed';
    const decisionModel = connected ? 'ok' : 'degraded';
    const value = buildStatus({
      now: now(),
      pricesAt: p.pricesAt,
      fxAsOf: p.fxAsOf,
      rdapRefreshedAt: svc.rdapRefreshedAt(),
      jobs,
      decisionModel,
    });
    cached = { at: now(), value };
    return value;
  };
}
