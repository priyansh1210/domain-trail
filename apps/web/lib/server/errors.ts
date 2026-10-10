// Server error reports to Sentry (spec 015 FR-OBS-001, 009; spec 013 FR-PRIV-004; tasks/M6-launch.md decision 2).
// No SDK: one small request to Sentry's ingestion endpoint. Events carry the error type, a scrubbed message, the
// stack's file/line/function names and the route — never request bodies, headers, cookies, query strings or
// anything that looks like an e-mail address or IP. Nothing is sent without SENTRY_DSN.
import { timedFetch } from '@domains-all/config/net';
import { scrubText } from '@domains-all/log';

export interface Dsn {
  host: string;
  projectId: string;
  publicKey: string;
}

/** `https://<key>@o123.ingest.sentry.io/<project>` → parts, or null. */
export function parseDsn(dsn: string | undefined): Dsn | null {
  if (!dsn) return null;
  try {
    const u = new URL(dsn);
    const projectId = u.pathname.replace(/^\//, '');
    if (u.protocol !== 'https:' || !u.username || !/^\d+$/.test(projectId)) return null;
    return { host: u.host, projectId, publicKey: u.username };
  } catch {
    return null;
  }
}

export interface ErrorContext {
  /** Route pattern such as `/api/me/watchlist/[fqdn]` (no real values). */
  route?: string;
  method?: string;
  kind?: string;
}

const MAX_FRAMES = 30;

/** Builds the event from whitelisted fields only (spec 015 §5.3: no free text beyond the scrubbed message). */
export function errorEvent(err: unknown, ctx: ErrorContext, release?: string): Record<string, unknown> {
  const e = err instanceof Error ? err : new Error(String(err));
  const frames = (e.stack ?? '')
    .split('\n')
    .slice(1)
    .map((line) => /at (?:(.+?) \()?(.+?):(\d+):(\d+)\)?$/.exec(line.trim()))
    .filter((m): m is RegExpExecArray => !!m)
    .slice(0, MAX_FRAMES)
    .map((m) => ({
      function: m[1] ?? '?',
      filename: m[2]!.replace(/^.*[\\/](\.next|node_modules)[\\/]/, '$1/'),
      lineno: Number(m[3]),
      colno: Number(m[4]),
    }))
    .reverse(); // Sentry wants the innermost frame last
  return {
    event_id: crypto.randomUUID().replace(/-/g, ''),
    timestamp: Date.now() / 1000,
    platform: 'node',
    level: 'error',
    ...(release ? { release } : {}),
    exception: {
      values: [{ type: e.name, value: scrubText(e.message).slice(0, 500), stacktrace: { frames } }],
    },
    tags: {
      ...(ctx.route ? { route: ctx.route } : {}),
      ...(ctx.method ? { method: ctx.method } : {}),
      ...(ctx.kind ? { kind: ctx.kind } : {}),
    },
  };
}

export async function reportError(
  err: unknown,
  ctx: ErrorContext,
  env: { SENTRY_DSN?: string; VERCEL_GIT_COMMIT_SHA?: string },
  fetchFn?: typeof fetch,
): Promise<'sent' | 'off' | 'failed'> {
  const dsn = parseDsn(env.SENTRY_DSN);
  if (!dsn) return 'off';
  const event = errorEvent(err, ctx, env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12));
  const envelope = [
    JSON.stringify({ event_id: event.event_id, sent_at: new Date().toISOString() }),
    JSON.stringify({ type: 'event' }),
    JSON.stringify(event),
  ].join('\n');
  const res = await timedFetch(`https://${dsn.host}/api/${dsn.projectId}/envelope/`, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-sentry-envelope',
      'x-sentry-auth': `Sentry sentry_version=7, sentry_key=${dsn.publicKey}, sentry_client=domains-all/1.0`,
    },
    body: envelope,
    timeoutMs: 3000,
    fetchFn,
  });
  return res?.ok ? 'sent' : 'failed';
}
