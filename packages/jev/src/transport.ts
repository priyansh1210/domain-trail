// HTTP transport to Jev (spec 002 tech §5.2): gateway or direct route, per-request timeout bounded by the stage
// deadline, limited retries with jittered backoff, request ids logged (FR-JEV-005, 006, 010, 011).
import type { Logger } from '@domains-all/log';
import type { SystemOneRequest, SystemOneResponse } from './types';

export const ROUTES = {
  gateway: 'https://ai-gateway.vercel.sh/typesafe/v1/systemone',
  direct: 'https://api.typesafe.ai/v1/systemone',
} as const;

export type Route = keyof typeof ROUTES;

export type SendResult =
  | { ok: true; response: SystemOneResponse; requestId?: string; latencyMs: number }
  | { ok: false; status?: number; error: 'auth' | 'invalid' | 'retryable' | 'timeout'; requestId?: string };

export interface Transport {
  send(
    body: SystemOneRequest,
    ctx: { deadline: number; searchId: string; stage?: string },
  ): Promise<SendResult>;
}

export interface HttpTransportOptions {
  route: Route;
  apiKey: string;
  requestTimeoutMs?: number;
  maxRetries?: number;
  fetchFn?: typeof fetch;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  log?: Pick<Logger, 'info' | 'warn' | 'error'>;
}

const BACKOFF_MS = [300, 900];
const RETRYABLE = new Set([429, 529, 500, 502, 503, 504]);

export function createHttpTransport(opts: HttpTransportOptions): Transport {
  const fetchFn = opts.fetchFn ?? fetch;
  const now = opts.now ?? Date.now;
  const sleep = opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const random = opts.random ?? Math.random;
  const maxRetries = opts.maxRetries ?? 2;
  const requestTimeoutMs = opts.requestTimeoutMs ?? 8000;

  return {
    async send(body, ctx) {
      let lastStatus: number | undefined;
      let lastRequestId: string | undefined;
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        const remaining = ctx.deadline - now();
        if (remaining < 50)
          return { ok: false, error: 'timeout', status: lastStatus, requestId: lastRequestId };
        const started = now();
        let res: Response;
        try {
          res = await fetchFn(ROUTES[opts.route], {
            method: 'POST',
            headers: { 'content-type': 'application/json', authorization: `Bearer ${opts.apiKey}` },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(Math.min(requestTimeoutMs, remaining)),
          });
        } catch (e) {
          const timedOut = (e as Error).name === 'TimeoutError' || (e as Error).name === 'AbortError';
          opts.log?.warn({
            event: 'jev.request',
            searchId: ctx.searchId,
            stage: ctx.stage,
            attempt,
            error: timedOut ? 'timeout' : 'network',
            route: opts.route,
          });
          if (timedOut && now() >= ctx.deadline - 50) return { ok: false, error: 'timeout' };
          if (!(await backoff(attempt, undefined)))
            return { ok: false, error: timedOut ? 'timeout' : 'retryable' };
          continue;
        }

        const requestId = res.headers.get('x-typesafe-request-id') ?? undefined;
        lastStatus = res.status;
        lastRequestId = requestId;
        const latencyMs = now() - started;
        const logBase = {
          event: 'jev.request',
          searchId: ctx.searchId,
          stage: ctx.stage,
          questions: Object.keys(body.questions).length,
          status: res.status,
          requestId,
          latencyMs,
          route: opts.route,
          attempt,
        };

        if (res.ok) {
          let json: SystemOneResponse;
          try {
            json = (await res.json()) as SystemOneResponse;
          } catch {
            opts.log?.warn({ ...logBase, error: 'bad_json' });
            return { ok: false, status: res.status, error: 'invalid', requestId };
          }
          opts.log?.info({ ...logBase, inputTokens: json.usage?.input_tokens });
          return { ok: true, response: json, requestId, latencyMs };
        }

        if (res.status === 401 || res.status === 403) {
          opts.log?.error({ ...logBase, error: 'auth' });
          return { ok: false, status: res.status, error: 'auth', requestId };
        }
        if (res.status === 422 || res.status === 400) {
          opts.log?.error({ ...logBase, error: 'invalid_request' });
          return { ok: false, status: res.status, error: 'invalid', requestId };
        }
        opts.log?.warn({ ...logBase, error: RETRYABLE.has(res.status) ? 'retryable' : 'unexpected' });
        if (!RETRYABLE.has(res.status))
          return { ok: false, status: res.status, error: 'retryable', requestId };
        if (!(await backoff(attempt, res.headers.get('retry-after')))) {
          return { ok: false, status: res.status, error: 'retryable', requestId };
        }
      }
      return { ok: false, status: lastStatus, error: 'retryable', requestId: lastRequestId };

      /** Waits before the next attempt; false when no attempt is left or the wait would pass the deadline. */
      async function backoff(attempt: number, retryAfter: string | null | undefined): Promise<boolean> {
        if (attempt >= maxRetries) return false;
        const base = BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)]!;
        let wait = base * (0.8 + random() * 0.4); // ±20 % jitter
        const retryAfterSec = retryAfter ? Number(retryAfter) : NaN;
        if (Number.isFinite(retryAfterSec)) wait = Math.max(wait, retryAfterSec * 1000);
        if (now() + wait >= ctx.deadline - 50) return false;
        await sleep(wait);
        return true;
      }
    },
  };
}
