// POST /api/search (spec 001 tech §1 steps 1–8, spec 014, spec 009 events). The response body is the event
// stream, so the description lives only in this request's memory (FR-INT-012).
import {
  cacheKey,
  newSearchId,
  parseSearchRef,
  runS1,
  SearchRequestSchema,
  searchRef,
  type SiteProfile,
} from '@domains-all/core';
import { PIPELINE_VERSION, rateLimits, retention } from '@domains-all/config';
import { log } from '@domains-all/log';
import type { Bucket } from './limits';
import { NotConfiguredError, type Services } from './services';
import { eventStream, readLimited, type EventSink } from './sse';
import { clientIp, visitorHash } from './visitor';

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  Response.json(body, { status, headers: { 'cache-control': 'no-store', ...headers } });

function fieldErrors(issues: Array<{ path: PropertyKey[]; message: string }>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const i of issues) out[i.path.map(String).join('.') || 'body'] ??= i.message;
  return out;
}

function replay(sink: EventSink, s: { id: string; ref: string; features: SiteProfile }) {
  sink.send('search_created', { searchId: s.id, ref: s.ref, cached: true });
  sink.send('features', s.features);
  sink.send('done', { counts: {}, durationMs: 0 });
}

export async function handleSearch(req: Request, svc: Services): Promise<Response> {
  const raw = await readLimited(req, rateLimits.requestBodyMaxBytes);
  if (raw === null) return json(413, { error: 'too_large', message: 'Request is too large.' });
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return json(400, { error: 'validation', fields: { body: 'Invalid JSON' } });
  }
  const parsed = SearchRequestSchema.safeParse(body);
  if (!parsed.success) return json(400, { error: 'validation', fields: fieldErrors(parsed.error.issues) });

  let secrets: { searchLink: string; visitorSalt: string };
  try {
    secrets = svc.secrets();
  } catch (e) {
    if (e instanceof NotConfiguredError) {
      log.error({ event: 'search.not_configured', error: e.message });
      return json(503, { error: 'not_configured', message: 'Search is not available right now.' });
    }
    throw e;
  }

  const ip = clientIp(req.headers);
  const human = await svc.verifyHuman(parsed.data.turnstileToken, ip);
  if (human === 'failed') return json(403, { error: 'human_check_failed', message: 'Please try again.' });

  if (svc.limitsEnforced) {
    const visitor = visitorHash(ip, req.headers.get('user-agent') ?? '', secrets.visitorSalt);
    const units = human === 'unavailable' ? 4 : 2; // human check down: stricter limits (spec 001 edge case)
    for (const bucket of ['search', 'search_day'] as Bucket[]) {
      const r = await svc.limiter.check(bucket, visitor, 'anonymous', units);
      if (!r.ok) {
        log.info({ event: 'search.limited', bucket });
        return json(
          429,
          { error: 'rate_limited', retryAfterSec: r.retryAfterSec, message: 'Search limit reached.' },
          { 'retry-after': String(r.retryAfterSec ?? 60) },
        );
      }
    }
  }

  const id = newSearchId();
  const ref = searchRef(id, secrets.searchLink);
  const duplicate = await svc.idempotency.claim(parsed.data.clientRequestId, ref);
  if (duplicate) return json(409, { error: 'duplicate_request', ref: duplicate });

  const { description, preferences } = parsed.data;
  const key = cacheKey(description, preferences);

  // FR-INT-008: identical search within 24 h → stored result.
  const cachedId = await svc.store.cacheLookup(key).catch(() => null);
  if (cachedId) {
    const rec = await svc.store.getSearch(cachedId).catch(() => null);
    if (rec?.status === 'done' && rec.features) {
      const features = rec.features;
      log.info({ event: 'search', outcome: 'cache_hit', searchId: rec.id });
      return eventStream(async (sink) =>
        replay(sink, { id: rec.id, ref: searchRef(rec.id, secrets.searchLink), features }),
      );
    }
  }

  return eventStream(async (sink) => {
    const started = Date.now();
    sink.send('search_created', { searchId: id, ref, cached: false });

    let persisted = true;
    try {
      await svc.store.createSearch({
        id,
        cacheKey: key,
        prefs: preferences,
        pipelineVersion: PIPELINE_VERSION,
        expiresAt: new Date(started + retention.anonymousSearchDays * 86_400_000).toISOString(),
      });
    } catch (e) {
      persisted = false;
      log.warn({ event: 'search.not_saved', searchId: id, error: (e as Error).message });
      sink.send('notice', { code: 'not_saved', message: 'Results cannot be shared or reloaded right now.' });
    }

    sink.send('progress', { stage: 'features', pct: 5 });
    let outcome: Awaited<ReturnType<typeof runS1>>;
    try {
      outcome = await runS1({ description, preferences, searchId: id, jev: svc.jev });
    } catch (e) {
      log.error({ event: 'search.error', searchId: id, error: (e as Error).message });
      sink.send('error', { error: 'internal', message: 'Something went wrong. Please try again.' });
      if (persisted)
        await svc.store
          .completeSearch(id, {
            status: 'error',
            degraded: false,
            jevTokens: 0,
            durationMs: Date.now() - started,
            stageMs: {},
          })
          .catch(() => {});
      return;
    }

    const durationMs = Date.now() - started;
    const degraded = 'degraded' in outcome && outcome.degraded ? outcome.degraded : undefined;
    await svc.jev
      .recordSearch({
        tokens: outcome.usage.tokens,
        requests: outcome.usage.requests,
        degraded: Boolean(degraded),
      })
      .catch((e) => log.warn({ event: 'jev.usage_not_recorded', error: (e as Error).message }));
    if (degraded) sink.send('degraded', { reason: degraded });

    const status = outcome.kind === 'features' ? 'done' : outcome.kind;
    if (outcome.kind === 'refused') sink.send('refused', { reason: 'safety' });
    else if (outcome.kind === 'needs_detail') sink.send('needs_detail', { hints: outcome.hints });
    else {
      sink.send('features', outcome.profile);
      // M2 ends after S1; generation, availability and pricing stages arrive in M3–M4.
      sink.send('done', { counts: {}, durationMs });
    }

    log.info({
      event: 'search',
      outcome: status,
      searchId: id,
      durationMs,
      degraded: Boolean(degraded),
      tokens: outcome.usage.tokens,
    });
    if (!persisted) return;
    try {
      await svc.store.completeSearch(id, {
        status,
        features: outcome.kind === 'features' ? outcome.profile : null,
        degraded: Boolean(degraded),
        jevTokens: outcome.usage.tokens,
        durationMs,
        stageMs: { S1: durationMs },
      });
      if (status === 'done') {
        await svc.store.cachePut(
          key,
          id,
          new Date(started + retention.resultCacheHours * 3_600_000).toISOString(),
        );
      }
    } catch (e) {
      log.warn({ event: 'search.persist_failed', searchId: id, error: (e as Error).message });
    }
  });
}

/** GET /api/search/{ref}: snapshot for shared links and reloads (FR-UX-006). No personal data inside. */
export async function handleSnapshot(ref: string, svc: Services): Promise<Response> {
  let secret: string;
  try {
    secret = svc.secrets().searchLink;
  } catch {
    return json(503, { error: 'not_configured' });
  }
  const id = parseSearchRef(ref, secret);
  if (!id) return json(404, { error: 'not_found', message: 'These results do not exist.' });
  const rec = await svc.store.getSearch(id).catch(() => null);
  if (!rec) return json(404, { error: 'expired', message: 'These results have expired.' });
  return json(200, {
    searchId: rec.id,
    ref,
    status: rec.status,
    createdAt: rec.createdAt,
    expiresAt: rec.expiresAt,
    profile: rec.features,
    results: [],
    degraded: rec.degraded,
  });
}
