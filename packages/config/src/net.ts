// Outbound HTTP with a hard time limit (spec 000 NFR: every external call is bounded). The limit covers the
// connection and reading the body, and settles even when the runtime does not honour the abort signal — on the
// production host some requests stayed open after AbortSignal.timeout and a search never finished (2026-10-04).

export interface TimedResponse {
  status: number;
  ok: boolean;
  headers: Headers;
  /** Body text, or undefined when it was larger than `maxBytes`. */
  text: string | undefined;
}

export interface TimedFetchOptions extends Omit<RequestInit, 'signal'> {
  timeoutMs: number;
  maxBytes?: number;
  fetchFn?: typeof fetch;
}

/** Resolves with the response and its body, or undefined on network error, timeout or abort. Never hangs. */
export async function timedFetch(url: string, opts: TimedFetchOptions): Promise<TimedResponse | undefined> {
  const { timeoutMs, maxBytes, fetchFn, ...init } = opts;
  const ctrl = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => {
      ctrl.abort();
      resolve(undefined);
    }, timeoutMs);
  });
  const work = (async (): Promise<TimedResponse | undefined> => {
    try {
      const res = await (fetchFn ?? fetch)(url, { ...init, signal: ctrl.signal });
      const declared = Number(res.headers.get('content-length'));
      if (maxBytes !== undefined && Number.isFinite(declared) && declared > maxBytes) {
        void res.body?.cancel().catch(() => undefined);
        return { status: res.status, ok: res.ok, headers: res.headers, text: undefined };
      }
      const text = await res.text();
      return {
        status: res.status,
        ok: res.ok,
        headers: res.headers,
        text: maxBytes !== undefined && text.length > maxBytes ? undefined : text,
      };
    } catch {
      return undefined;
    }
  })();
  try {
    return await Promise.race([work, expired]);
  } finally {
    clearTimeout(timer);
  }
}

/** Waits for a promise, but no longer than `ms`; then gives `fallback`. */
export async function within<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(fallback), Math.max(0, ms));
  });
  try {
    return await Promise.race([promise.catch(() => fallback), late]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Headers for the database's REST interface with the public key. Supabase's newer publishable keys
 * (`sb_publishable_…`) are not JWTs and are refused in `Authorization: Bearer`, so they go only in `apikey`;
 * older anon keys (JWTs, `eyJ…`) are also sent as Bearer, as before.
 */
export function publicKeyHeaders(key: string): Record<string, string> {
  return key.startsWith('eyJ') ? { apikey: key, authorization: `Bearer ${key}` } : { apikey: key };
}
