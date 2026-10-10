// POST /api/search (spec 001 tech §1 steps 1–8, spec 014, spec 009 events). The response body is the event
// stream, so the description lives only in this request's memory (FR-INT-012).
import {
  cacheKey,
  newSearchId,
  parseSearchRef,
  runNames,
  runS1,
  SearchRequestSchema,
  searchRef,
  type SiteProfile,
} from '@domains-all/core';
import { PIPELINE_VERSION, rateLimits, retention } from '@domains-all/config';
import { log } from '@domains-all/log';
import type { Bucket } from './limits';
import { NotConfiguredError, type Services } from './services';
import type { SessionUser } from './session';
import { eventStream, readLimited, type EventSink } from './sse';
import type { StoredResults } from './store';
import { countBySection, sendPricing, streamVerify } from './verify-stream';
import { clientIp, visitorHash } from './visitor';

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  Response.json(body, { status, headers: { 'cache-control': 'no-store', ...headers } });

function fieldErrors(issues: Array<{ path: PropertyKey[]; message: string }>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const i of issues) out[i.path.map(String).join('.') || 'body'] ??= i.message;
  return out;
}

/** Signed-in visitors are limited per account with the higher signed-in limits (FR-ABU-002); others per visitor. */
export function limitKey(
  user: SessionUser | null | undefined,
  visitor: string,
): { key: string; tier: 'anonymous' | 'signedIn' } {
  return user && !user.isAnonymous
    ? { key: `user:${user.id}`, tier: 'signedIn' }
    : { key: visitor, tier: 'anonymous' };
}

/** Names, availability, prices and sections for a known profile (stages S2–S9), shared by search and refine. */
export async function resultsStage(
  sink: EventSink,
  svc: Services,
  a: {
    id: string;
    started: number;
    s1Ms: number;
    description: string;
    preferences: Parameters<typeof runNames>[0]['preferences'];
    profile: SiteProfile;
    strictBrand: boolean;
    seed: string;
    degraded?: string;
  },
): Promise<{
  stored: StoredResults;
  stageMs: Record<string, number>;
  degraded?: string;
  usage: { tokens: number; requests: number };
}> {
  sink.send('progress', { stage: 'names', pct: 30 });
  let counts = countBySection({});
  let dataAgeHours: number | undefined;
  let stored: StoredResults = { results: [], sections: {} };
  let stageMs: Record<string, number> = { S1: a.s1Ms };
  let degraded = a.degraded;
  const usage = { tokens: 0, requests: 0 };
  try {
    const names = await runNames({
      description: a.description,
      preferences: a.preferences,
      profile: a.profile,
      strictBrand: a.strictBrand,
      searchId: a.id,
      seed: a.seed,
      jev: svc.jev,
      live: !svc.env.MOCK_EXTERNALS,
      wordCache: svc.wordCache,
    });
    usage.tokens += names.usage.tokens;
    usage.requests += names.usage.requests;
    if (names.degraded && !degraded) {
      degraded = names.degraded;
      sink.send('degraded', { reason: degraded });
    }
    const namesMs = Date.now() - a.started - a.s1Ms;
    const verified = await streamVerify(sink, svc, {
      names,
      profile: a.profile,
      includeFree: a.preferences.includeFree,
      allowHyphens: a.preferences.allowHyphens,
    });
    stored = verified.stored;
    counts = verified.counts;
    dataAgeHours = verified.dataAgeHours;
    if (names.lowSupply || stored.results.length < 10)
      sink.send('notice', {
        code: 'low_supply',
        message: 'We found fewer good names than usual. Try adding detail or relaxing the options.',
      });
    stageMs = { S1: a.s1Ms, names: namesMs, verify: Date.now() - a.started - a.s1Ms - namesMs };
  } catch (e) {
    // The chips are already shown; a failure here should not turn the whole search into an error.
    log.error({ event: 'search.results_failed', searchId: a.id, error: (e as Error).message });
    sink.send('notice', { code: 'partial', message: 'Some results could not be loaded.' });
  }
  sink.send('done', {
    counts,
    sections: stored.sections,
    durationMs: Date.now() - a.started,
    ...(dataAgeHours === undefined ? {} : { dataAgeHours }),
  });
  return { stored, stageMs, ...(degraded ? { degraded } : {}), usage };
}

function replay(
  sink: EventSink,
  svc: Services,
  s: { id: string; ref: string; features: SiteProfile; stored: StoredResults },
) {
  sink.send('search_created', { searchId: s.id, ref: s.ref, cached: true });
  sink.send('features', s.features);
  sendPricing(sink, svc);
  if (s.stored.results.length) sink.send('batch', { results: s.stored.results });
  sink.send('done', {
    counts: countBySection(s.stored.sections),
    sections: s.stored.sections,
    durationMs: 0,
  });
}

export async function handleSearch(
  req: Request,
  svc: Services,
  user?: SessionUser | null,
): Promise<Response> {
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
    const { key: limitBy, tier } = limitKey(user, visitor);
    const units = human === 'unavailable' ? 4 : 2; // human check down: stricter limits (spec 001 edge case)
    for (const bucket of ['search', 'search_day'] as Bucket[]) {
      const r = await svc.limiter.check(bucket, limitBy, tier, units);
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
      const stored = await svc.store.getResults(rec.id).catch(() => ({ results: [], sections: {} }));
      log.info({ event: 'search', outcome: 'cache_hit', searchId: rec.id });
      return eventStream(async (sink) =>
        replay(sink, svc, { id: rec.id, ref: searchRef(rec.id, secrets.searchLink), features, stored }),
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
        ...(user && !user.isAnonymous ? { userId: user.id } : {}),
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

    const s1Ms = Date.now() - started;
    let degraded = 'degraded' in outcome && outcome.degraded ? outcome.degraded : undefined;
    if (degraded) sink.send('degraded', { reason: degraded });
    const usage = { ...outcome.usage };

    const status = outcome.kind === 'features' ? 'done' : outcome.kind;
    let stored: StoredResults = { results: [], sections: {} };
    let stageMs: Record<string, number> = { S1: s1Ms };
    if (outcome.kind === 'refused') sink.send('refused', { reason: 'safety' });
    else if (outcome.kind === 'needs_detail') sink.send('needs_detail', { hints: outcome.hints });
    else {
      sink.send('features', outcome.profile);
      // S2–S6: names ranked by Jev (or the deterministic fallback); S7–S9: availability, prices, sections.
      const r = await resultsStage(sink, svc, {
        id,
        started,
        s1Ms,
        description,
        preferences,
        profile: outcome.profile,
        strictBrand: outcome.strictBrand,
        seed: key,
        ...(degraded ? { degraded } : {}),
      });
      stored = r.stored;
      stageMs = r.stageMs;
      degraded = (r.degraded as typeof degraded) ?? degraded;
      usage.tokens += r.usage.tokens;
      usage.requests += r.usage.requests;
    }

    const durationMs = Date.now() - started;
    await svc.jev
      .recordSearch({ tokens: usage.tokens, requests: usage.requests, degraded: Boolean(degraded) })
      .catch((e) => log.warn({ event: 'jev.usage_not_recorded', error: (e as Error).message }));

    log.info({
      event: 'search',
      outcome: status,
      searchId: id,
      durationMs,
      degraded: Boolean(degraded),
      tokens: usage.tokens,
      results: stored.results.length,
    });
    if (!persisted) return;
    try {
      await svc.store.completeSearch(id, {
        status,
        features: outcome.kind === 'features' ? outcome.profile : null,
        degraded: Boolean(degraded),
        jevTokens: usage.tokens,
        durationMs,
        stageMs,
      });
      if (stored.results.length) await svc.store.saveResults(id, stored);
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
  const book = svc.prices.get();
  return json(200, {
    searchId: rec.id,
    ref,
    status: rec.status,
    createdAt: rec.createdAt,
    expiresAt: rec.expiresAt,
    profile: rec.features,
    ...(await svc.store.getResults(rec.id).catch(() => ({ results: [], sections: {} }))),
    pricing: { fx: book.fx, pricesAt: book.pricesAt, source: book.provider.name },
    degraded: rec.degraded,
  });
}
