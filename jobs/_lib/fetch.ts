// Downloads for jobs (spec 010 tech §8): 3 attempts with a pause between them, a time limit per attempt and a size
// limit. A source that keeps failing makes the job fail without touching yesterday's data.
import { jobs as cfg } from '@domains-all/config/defaults';
import type { JobContext } from './run';

export interface DownloadOptions {
  timeoutMs?: number;
  maxBytes?: number;
  headers?: Record<string, string>;
  method?: 'GET' | 'POST';
  body?: string;
}

/** Plain user agent with the project address, so data publishers can reach us. */
export function userAgent(ctx: Pick<JobContext, 'env'>): string {
  const site = ctx.env.NEXT_PUBLIC_SITE_URL;
  return `${(ctx.env.NEXT_PUBLIC_SITE_NAME ?? 'domains-all').replace(/[^\w.-]/g, '')}-jobs (+${site})`;
}

async function attempt(ctx: JobContext, url: string, opts: DownloadOptions): Promise<Uint8Array> {
  const res = await ctx.fetch(url, {
    method: opts.method ?? 'GET',
    headers: { 'user-agent': userAgent(ctx), ...opts.headers },
    ...(opts.body ? { body: opts.body } : {}),
    signal: AbortSignal.timeout(opts.timeoutMs ?? 60_000),
  });
  if (!res.ok) {
    await res.body?.cancel().catch(() => undefined);
    throw new HttpError(url, res.status);
  }
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (opts.maxBytes !== undefined && bytes.byteLength > opts.maxBytes)
    throw new Error(`${new URL(url).host}: answer larger than ${opts.maxBytes} bytes`);
  return bytes;
}

export class HttpError extends Error {
  constructor(
    readonly url: string,
    readonly status: number,
  ) {
    super(`${new URL(url).host}${new URL(url).pathname} → HTTP ${status}`);
  }
}

/** Retries network errors and 5xx/429 answers; other 4xx answers fail at once (retrying cannot help). */
export async function download(
  ctx: JobContext,
  url: string,
  opts: DownloadOptions = {},
): Promise<Uint8Array> {
  let last: unknown;
  for (let i = 1; i <= cfg.downloadAttempts; i++) {
    try {
      return await attempt(ctx, url, opts);
    } catch (e) {
      last = e;
      const permanent = e instanceof HttpError && e.status >= 400 && e.status < 500 && e.status !== 429;
      if (permanent || i === cfg.downloadAttempts) break;
      await ctx.sleep(ctx.dryRun ? 0 : cfg.downloadBackoffMs);
    }
  }
  throw last instanceof Error ? last : new Error(String(last));
}

export async function downloadText(ctx: JobContext, url: string, opts: DownloadOptions = {}) {
  return new TextDecoder().decode(await download(ctx, url, opts));
}

export async function downloadJson<T = unknown>(ctx: JobContext, url: string, opts: DownloadOptions = {}) {
  return JSON.parse(await downloadText(ctx, url, opts)) as T;
}

/**
 * Reads the first `maxLines` lines of a large text file and then stops the download (the popular-site list is
 * ~80 MB; we need the top 100,000 rows only).
 */
export async function downloadLines(
  ctx: JobContext,
  url: string,
  maxLines: number,
  opts: DownloadOptions = {},
): Promise<string[]> {
  let last: unknown;
  for (let i = 1; i <= cfg.downloadAttempts; i++) {
    try {
      const res = await ctx.fetch(url, {
        headers: { 'user-agent': userAgent(ctx), ...opts.headers },
        signal: AbortSignal.timeout(opts.timeoutMs ?? 300_000),
      });
      if (!res.ok || !res.body) throw new HttpError(url, res.status);
      const lines: string[] = [];
      const decoder = new TextDecoder();
      const reader = res.body.getReader();
      let rest = '';
      while (lines.length < maxLines) {
        const { done, value } = await reader.read();
        if (done) break;
        const parts = (rest + decoder.decode(value, { stream: true })).split(/\r?\n/);
        rest = parts.pop() ?? '';
        lines.push(...parts);
      }
      if (rest && lines.length < maxLines) lines.push(rest);
      await reader.cancel().catch(() => undefined);
      return lines.slice(0, maxLines);
    } catch (e) {
      last = e;
      if (i < cfg.downloadAttempts) await ctx.sleep(ctx.dryRun ? 0 : cfg.downloadBackoffMs);
    }
  }
  throw last instanceof Error ? last : new Error(String(last));
}
