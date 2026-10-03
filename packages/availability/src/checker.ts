// checkMany / recheckOne (spec 005 tech §1, §5): fresh cache → DNS pre-check → registry RDAP, streamed as each name
// finishes. Anything not answered in time is "unknown" (honest uncertainty, FR-AVL-008); daily caps switch to
// cache-only mode (FR-AVL-013).
import { availability } from '@domains-all/config/defaults';
import { within } from '@domains-all/config/net';
import { type AvailabilityCache, makeResult, MemoryAvailabilityCache } from './cache';
import type { RdapDirectory } from './directory';
import { dohNs, dohQuery, resolves, type NsVerdict } from './doh';
import { HostLimiter, Semaphore } from './limiter';
import { rdapLookup } from './rdap';
import { type CheckResult, splitFqdn } from './types';

/** Daily request totals across searches (Upstash in live mode, memory otherwise). */
export interface DailyCounter {
  /** Adds `n` to today's total for `kind` and returns the new total. `add(kind, 0)` reads it. */
  add(kind: 'rdap' | 'doh', n: number): Promise<number>;
}

export class MemoryDailyCounter implements DailyCounter {
  private day = '';
  private totals = { rdap: 0, doh: 0 };

  constructor(private readonly now: () => number = Date.now) {}

  async add(kind: 'rdap' | 'doh', n: number): Promise<number> {
    const day = new Date(this.now()).toISOString().slice(0, 10);
    if (day !== this.day) {
      this.day = day;
      this.totals = { rdap: 0, doh: 0 };
    }
    this.totals[kind] += n;
    return this.totals[kind];
  }
}

export interface CheckerOptions {
  directory: { get(): RdapDirectory };
  userAgent: string;
  cache?: AvailabilityCache;
  fetchFn?: typeof fetch;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  limiter?: HostLimiter;
  counter?: DailyCounter;
  /** Random label generator for wildcard detection (injectable for tests). */
  randomLabel?: () => string;
}

export interface CheckContext {
  /** Epoch milliseconds; names still open then are reported as "unknown". */
  deadline: number;
  onResult?: (r: CheckResult) => void;
  /** Ignore cached answers (re-check button). */
  force?: boolean;
  /** Names about to be shown near the top: a cached "available" older than 30 minutes is verified again. */
  reverify?: ReadonlySet<string>;
  /** A re-verification changed a cached answer. */
  onUpdate?: (r: CheckResult) => void;
}

export interface CheckStats {
  cached: number;
  dohQueries: number;
  rdapRequests: number;
  late: number;
  paused: boolean;
  byStatus: Record<string, number>;
}

const DAY_MS = 86_400_000;

function randomLabel(): string {
  let s = '';
  for (let i = 0; i < 20; i++) s += String.fromCharCode(97 + Math.floor(Math.random() * 26));
  return s;
}

export function createChecker(opts: CheckerOptions) {
  const now = opts.now ?? Date.now;
  const cache = opts.cache ?? new MemoryAvailabilityCache();
  const limiter = opts.limiter ?? new HostLimiter({ now, sleep: opts.sleep });
  const counter = opts.counter ?? new MemoryDailyCounter(now);
  const wildcards = new Map<string, { value: boolean; at: number }>();
  const wildcardTtl = availability.directoryRefreshHours * 3600_000;

  /** An extension whose DNS answers every name cannot be pre-checked by DNS (tech §5.5). */
  async function isWildcard(tld: string, budget: { doh: number }): Promise<boolean> {
    const known = wildcards.get(tld);
    if (known && now() - known.at < wildcardTtl) return known.value;
    budget.doh++;
    const answer = await dohQuery(`${(opts.randomLabel ?? randomLabel)()}.${tld}`, 'A', {
      fetchFn: opts.fetchFn,
    });
    const value = resolves(answer);
    if (answer) wildcards.set(tld, { value, at: now() });
    return value;
  }

  async function checkMany(
    fqdns: readonly string[],
    ctx: CheckContext,
  ): Promise<{ results: CheckResult[]; stats: CheckStats }> {
    const list = [...new Set(fqdns.map((f) => f.toLowerCase()))];
    const out = new Map<string, CheckResult>();
    const stats: CheckStats = {
      cached: 0,
      dohQueries: 0,
      rdapRequests: 0,
      late: 0,
      paused: false,
      byStatus: {},
    };
    const emit = (r: CheckResult) => {
      out.set(r.fqdn, r);
      ctx.onResult?.(r);
    };

    const fresh = ctx.force
      ? new Map<string, CheckResult>()
      : await within(cache.getMany(list, now()), 1500, new Map<string, CheckResult>()); // slow cache = miss
    const reverify: string[] = [];
    for (const [fqdn, r] of fresh) {
      stats.cached++;
      emit({ ...r, method: 'cache' });
      const age = now() - Date.parse(r.checkedAt);
      if (
        r.status === 'available' &&
        ctx.reverify?.has(fqdn) &&
        age > availability.reverifyAfterSeconds * 1000
      )
        reverify.push(fqdn);
    }
    const misses = list.filter((f) => !fresh.has(f));

    // Daily caps reached → cache-only mode with a notice (the caller shows "checks paused").
    const [dohToday, rdapToday] = await Promise.all([counter.add('doh', 0), counter.add('rdap', 0)]);
    if (dohToday >= availability.dohDailyCap || rdapToday >= availability.rdapDailyCap) {
      stats.paused = true;
      for (const fqdn of misses) emit(makeResult(fqdn, splitFqdn(fqdn).tld, 'unknown', 'dns', now()));
      return finish();
    }

    const budget = { doh: 0, rdap: 0, rdapSlots: 0 };
    const dohGate = new Semaphore(availability.dohConcurrency);
    const directory = opts.directory.get();
    const fresher: CheckResult[] = [];
    const timeLeft = () => ctx.deadline - now();

    async function rdapStage(fqdn: string, tld: string, verdict: NsVerdict): Promise<CheckResult> {
      const base = directory.baseFor(tld);
      if (!base) {
        // No registry RDAP (e.g. .io, .co): DNS alone can only say "likely available" (FR-AVL-008).
        return makeResult(fqdn, tld, verdict === 'not_found' ? 'likely_available' : 'unknown', 'dns', now());
      }
      if (budget.rdapSlots >= availability.rdapMaxPerSearch || timeLeft() <= 0)
        return makeResult(fqdn, tld, 'unknown', 'rdap', now());
      budget.rdapSlots++; // reserved before waiting, so parallel names cannot overshoot the cap
      const host = new URL(base).host;
      const outcome = await limiter.run(host, () =>
        timeLeft() <= 0
          ? Promise.resolve({ status: 'unknown' as const })
          : rdapLookup(fqdn, base, {
              fetchFn: opts.fetchFn,
              userAgent: opts.userAgent,
              sleep: opts.sleep,
              timeoutMs: Math.max(200, Math.min(availability.rdapTimeoutMs, timeLeft())),
              onRequest: () => {
                budget.rdap++;
              },
            }),
      );
      if ('rateLimited' in outcome && outcome.rateLimited) limiter.slowDown(host);
      if (outcome.status === 'dropping_soon' && 'expiration' in outcome && outcome.expiration) {
        const exp = Date.parse(outcome.expiration);
        const dropWindow = Number.isFinite(exp)
          ? {
              start: new Date(exp + 30 * DAY_MS).toISOString().slice(0, 10),
              end: new Date(exp + 35 * DAY_MS).toISOString().slice(0, 10),
            }
          : undefined;
        return makeResult(fqdn, tld, 'dropping_soon', 'rdap', now(), dropWindow ? { dropWindow } : {});
      }
      return makeResult(fqdn, tld, outcome.status, 'rdap', now());
    }

    async function checkOne(fqdn: string): Promise<CheckResult> {
      const { tld } = splitFqdn(fqdn);
      let verdict: NsVerdict = 'unclear';
      const skipDns = await isWildcard(tld, budget);
      if (!skipDns && budget.doh < availability.dohMaxPerSearch && timeLeft() > 0) {
        budget.doh++;
        verdict = await dohGate.run(() =>
          dohNs(fqdn, {
            fetchFn: opts.fetchFn,
            timeoutMs: Math.min(availability.dohTimeoutMs, Math.max(200, timeLeft())),
          }),
        );
        if (verdict === 'registered') return makeResult(fqdn, tld, 'taken', 'dns', now());
      }
      return rdapStage(fqdn, tld, verdict);
    }

    // Names still open at the deadline are reported as unknown; their late answers still refresh the cache.
    let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
    const deadlineHit = new Promise<'late'>((resolve) => {
      deadlineTimer = setTimeout(() => resolve('late'), Math.max(0, timeLeft()));
    });
    const lateWrites: Array<Promise<unknown>> = [];

    await Promise.all([
      ...misses.map(async (fqdn) => {
        const task = checkOne(fqdn).catch(() =>
          makeResult(fqdn, splitFqdn(fqdn).tld, 'unknown', 'dns', now()),
        );
        const first = await Promise.race([task, deadlineHit]);
        if (first === 'late') {
          stats.late++;
          emit(makeResult(fqdn, splitFqdn(fqdn).tld, 'unknown', 'dns', now()));
          lateWrites.push(task.then((r) => cache.putMany([r])).catch(() => undefined));
          return;
        }
        fresher.push(first);
        emit(first);
      }),
      ...reverify.map(async (fqdn) => {
        const { tld } = splitFqdn(fqdn);
        const r = await Promise.race([rdapStage(fqdn, tld, 'not_found'), deadlineHit]).catch(
          () => 'late' as const,
        );
        if (r === 'late') return;
        fresher.push(r);
        if (r.status !== 'available') {
          out.set(fqdn, r);
          ctx.onUpdate?.(r);
        }
      }),
    ]);
    clearTimeout(deadlineTimer);
    void Promise.all(lateWrites);

    stats.dohQueries = budget.doh;
    stats.rdapRequests = budget.rdap;
    await Promise.all([counter.add('doh', budget.doh), counter.add('rdap', budget.rdap)]).catch(
      () => undefined,
    );
    await within(cache.putMany(fresher), 2000, undefined);
    return finish();

    function finish() {
      const results = list.map((f) => out.get(f)).filter((r): r is CheckResult => !!r);
      for (const r of results) stats.byStatus[r.status] = (stats.byStatus[r.status] ?? 0) + 1;
      return { results, stats };
    }
  }

  /** Fresh check of one name for the "Re-check" button (FR-AVL-014, NFR-AVL-004: under 3 s). */
  async function recheckOne(fqdn: string): Promise<CheckResult> {
    const { results } = await checkMany([fqdn], { deadline: now() + 2800, force: true });
    return results[0] ?? makeResult(fqdn.toLowerCase(), splitFqdn(fqdn).tld, 'unknown', 'dns', now());
  }

  return { checkMany, recheckOne };
}

export type Checker = ReturnType<typeof createChecker>;
