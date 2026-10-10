// POST /api/search/{ref}/refine (spec 003 FR-FEAT-011, OpenAPI `RefineRequest`): results again with the user's edited
// feature chips, without repeating detection. Signed-in (not anonymous) users only; costs half a search
// (FR-ABU-002). The edited profile becomes a new search with its own link; the description is used in memory only.
import {
  applyFeatureEdits,
  cacheKey,
  DescriptionSchema,
  FeatureEditsSchema,
  hasEdits,
  newSearchId,
  parseSearchRef,
  PreferencesSchema,
  searchRef,
} from '@domains-all/core';
import { PIPELINE_VERSION, rateLimits, retention } from '@domains-all/config';
import { log } from '@domains-all/log';
import { createHash } from 'node:crypto';
import * as z from 'zod/mini';
import type { Bucket } from './limits';
import { limitKey, resultsStage } from './search';
import type { Services } from './services';
import { sameOrigin, type SessionUser } from './session';
import { eventStream, readLimited } from './sse';
import { clientIp, visitorHash } from './visitor';

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  Response.json(body, { status, headers: { 'cache-control': 'no-store', ...headers } });

const RefineSchema = z.object({
  description: DescriptionSchema,
  featureEdits: FeatureEditsSchema,
  turnstileToken: z.string().check(z.minLength(1), z.maxLength(4096)),
});

export async function handleRefine(
  req: Request,
  ref: string,
  svc: Services,
  user: SessionUser | null,
): Promise<Response> {
  if (!sameOrigin(req)) return json(403, { error: 'forbidden' });
  if (!user || user.isAnonymous)
    return json(401, { error: 'unauthorized', message: 'Sign in to edit the detected features.' });
  const raw = await readLimited(req, rateLimits.requestBodyMaxBytes);
  if (raw === null) return json(413, { error: 'too_large' });
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return json(400, { error: 'validation' });
  }
  const parsed = RefineSchema.safeParse(body);
  if (!parsed.success)
    return json(400, { error: 'validation', message: 'Please check the edited features.' });

  let secrets: { searchLink: string; visitorSalt: string };
  try {
    secrets = svc.secrets();
  } catch {
    return json(503, { error: 'not_configured' });
  }
  const oldId = parseSearchRef(ref, secrets.searchLink);
  const rec = oldId ? await svc.store.getSearch(oldId).catch(() => null) : null;
  if (!rec?.features) return json(404, { error: 'expired', message: 'These results have expired.' });
  const prefsParsed = PreferencesSchema.safeParse(rec.prefs ?? {});
  const preferences = prefsParsed.success ? prefsParsed.data : PreferencesSchema.parse({});
  const { description, featureEdits } = parsed.data;
  if (!hasEdits(rec.features, featureEdits))
    return json(400, { error: 'no_changes', message: 'Change at least one feature first.' });
  const profile = applyFeatureEdits(rec.features, featureEdits);

  const ip = clientIp(req.headers);
  const human = await svc.verifyHuman(parsed.data.turnstileToken, ip);
  if (human === 'failed') return json(403, { error: 'human_check_failed', message: 'Please try again.' });
  if (svc.limitsEnforced) {
    const visitor = visitorHash(ip, req.headers.get('user-agent') ?? '', secrets.visitorSalt);
    const { key, tier } = limitKey(user, visitor);
    for (const bucket of ['search', 'search_day'] as Bucket[]) {
      const r = await svc.limiter.check(bucket, key, tier, human === 'unavailable' ? 2 : 1);
      if (!r.ok)
        return json(
          429,
          { error: 'rate_limited', retryAfterSec: r.retryAfterSec, message: 'Search limit reached.' },
          { 'retry-after': String(r.retryAfterSec ?? 60) },
        );
    }
  }

  const id = newSearchId();
  const newRef = searchRef(id, secrets.searchLink);
  const editHash = createHash('sha256').update(JSON.stringify(featureEdits)).digest('hex').slice(0, 12);
  const seed = `${cacheKey(description, preferences)}:refine:${editHash}`;
  return eventStream(async (sink) => {
    const started = Date.now();
    sink.send('search_created', { searchId: id, ref: newRef, cached: false, refinedFrom: ref });
    let persisted = true;
    try {
      await svc.store.createSearch({
        id,
        cacheKey: seed,
        prefs: preferences,
        pipelineVersion: PIPELINE_VERSION,
        expiresAt: new Date(started + retention.anonymousSearchDays * 86_400_000).toISOString(),
        userId: user.id,
      });
    } catch {
      persisted = false;
      sink.send('notice', { code: 'not_saved', message: 'Results cannot be shared or reloaded right now.' });
    }
    sink.send('features', profile);
    const r = await resultsStage(sink, svc, {
      id,
      started,
      s1Ms: 0,
      description,
      preferences,
      profile,
      strictBrand: false,
      seed,
    });
    await svc.jev
      .recordSearch({ tokens: r.usage.tokens, requests: r.usage.requests, degraded: Boolean(r.degraded) })
      .catch(() => undefined);
    log.info({ event: 'search.refine', searchId: id, from: oldId, results: r.stored.results.length });
    if (!persisted) return;
    await svc.store
      .completeSearch(id, {
        status: 'done',
        features: profile,
        degraded: Boolean(r.degraded),
        jevTokens: r.usage.tokens,
        durationMs: Date.now() - started,
        stageMs: r.stageMs,
      })
      .then(() => (r.stored.results.length ? svc.store.saveResults(id, r.stored) : undefined))
      .catch((e: Error) => log.warn({ event: 'search.persist_failed', searchId: id, error: e.message }));
  });
}
