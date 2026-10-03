// HTTP transport to Jev (spec 002 tech §5.2): gateway or direct route, per-request timeout bounded by the stage
// deadline, limited retries with jittered backoff, request ids logged (FR-JEV-005, 006, 010, 011).
import { scrubText, type Logger } from '@domains-all/log';
import type { SystemOneRequest, SystemOneResponse } from './types';

export const ROUTES = {
  gateway: 'https://ai-gateway.vercel.sh/typesafe/v1/systemone',
  direct: 'https://api.typesafe.ai/v1/systemone',
} as const;

export type Route = keyof typeof ROUTES;

/** AI Gateway names models "maker/model" ("typesafe-ai/jev-1.13.0"); the rest of the app uses TypeSafe's names. */
export const GATEWAY_MODEL_PREFIX = 'typesafe-ai/';

export function wireModel(model: string, route: Route): string {
  return route === 'gateway' && !model.includes('/') ? GATEWAY_MODEL_PREFIX + model : model;
}

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
            body: JSON.stringify({ ...body, model: wireModel(body.model, opts.route) }),
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
          if (typeof json.model === 'string' && json.model.startsWith(GATEWAY_MODEL_PREFIX))
            json.model = json.model.slice(GATEWAY_MODEL_PREFIX.length);
          opts.log?.info({ ...logBase, inputTokens: json.usage?.input_tokens });
          return { ok: true, response: json, requestId, latencyMs };
        }

        const detail = await errorDetail(res);
        if (res.status === 401 || res.status === 403) {
          opts.log?.error({ ...logBase, error: 'auth', detail });
          return { ok: false, status: res.status, error: 'auth', requestId };
        }
        if (res.status === 422 || res.status === 400) {
          opts.log?.error({ ...logBase, error: 'invalid_request', detail });
          return { ok: false, status: res.status, error: 'invalid', requestId };
        }
        opts.log?.warn({ ...logBase, error: RETRYABLE.has(res.status) ? 'retryable' : 'unexpected', detail });
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

/** Statuses whose error text never quotes the request (key, credit, address problems): the message is kept. */
const MESSAGE_SAFE = new Set([401, 402, 403, 404, 405]);

/**
 * A short reason from an error response, for the logs. Rejected requests (400, 422, 5xx) might quote the
 * description, so for them only the error type or code is kept (P5).
 */
async function errorDetail(res: Response): Promise<string | undefined> {
  try {
    const text = (await res.text()).slice(0, 4000);
    let code: string | undefined;
    let message: string | undefined;
    try {
      const json = JSON.parse(text) as Record<string, unknown>;
      const err = (typeof json.error === 'object' && json.error !== null ? json.error : json) as Record<
        string,
        unknown
      >;
      code =
        [err.error_type, err.type, err.code].filter((x): x is string => typeof x === 'string').join('/') ||
        undefined;
      if (!code && typeof json.error === 'string') code = json.error;
      if (typeof err.message === 'string') message = err.message;
    } catch {
      message = text;
    }
    const out = MESSAGE_SAFE.has(res.status) ? [code, message].filter(Boolean).join(': ') : code;
    return out ? scrubText(out.replace(/\s+/g, ' ').trim()).slice(0, 200) : undefined;
  } catch {
    return undefined;
  }
}
