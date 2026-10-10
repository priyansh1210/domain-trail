// POST /api/search/{ref}/more (spec 006 FR-PRC-009, tech §5.5): new names priced in the chosen band, excluding
// names already shown. The description comes from the visitor's tab again (it is never stored, FR-INT-012); the
// detected features come from the stored search. Counts as half a search (FR-ABU-002).
import { rateLimits } from '@domains-all/config';
import {
  DescriptionSchema,
  parseSearchRef,
  PreferencesSchema,
  runNames,
  cacheKey,
  type ResultItem,
} from '@domains-all/core';
import { log } from '@domains-all/log';
import { tldsInBand } from '@domains-all/pricing';
import * as z from 'zod/mini';
import type { Bucket } from './limits';
import { limitKey } from './search';
import type { Services } from './services';
import type { SessionUser } from './session';
import { eventStream, readLimited } from './sse';
import { streamVerify } from './verify-stream';
import { clientIp, visitorHash } from './visitor';

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  Response.json(body, { status, headers: { 'cache-control': 'no-store', ...headers } });

const MoreSchema = z.object({
  description: DescriptionSchema,
  preferences: z._default(PreferencesSchema, () => PreferencesSchema.parse({})),
  turnstileToken: z.string().check(z.minLength(1), z.maxLength(4096)),
  priceMinCents: z.int().check(z.minimum(0), z.maximum(100_000_000)),
  priceMaxCents: z.nullable(z.int().check(z.minimum(0), z.maximum(100_000_000))),
  basis: z._default(z.enum(['upfront', 'renewal']), 'upfront'),
  exclude: z.array(z.string().check(z.maxLength(80))).check(z.maxLength(rateLimits.excludeListMax)),
});

/** Is the result inside the band on the chosen basis? Free names count only when the band starts at $0. */
export function inBand(
  item: ResultItem,
  min: number,
  max: number | null,
  basis: 'upfront' | 'renewal',
): boolean {
  if (item.section === 'free') return min === 0;
  if (!item.price) return false;
  const cents = basis === 'upfront' ? item.price.upfrontUsdCents : item.price.renewUsdCents;
  return cents >= min && (max === null || cents <= max);
}

export async function handleMore(
  req: Request,
  ref: string,
  svc: Services,
  user?: SessionUser | null,
): Promise<Response> {
  const raw = await readLimited(req, rateLimits.requestBodyMaxBytes + 40 * rateLimits.excludeListMax);
  if (raw === null) return json(413, { error: 'too_large', message: 'Request is too large.' });
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return json(400, { error: 'validation' });
  }
  const parsed = MoreSchema.safeParse(body);
  if (!parsed.success) return json(400, { error: 'validation' });
  const { description, preferences, priceMinCents, basis } = parsed.data;
  const priceMaxCents = parsed.data.priceMaxCents;
  if (priceMaxCents !== null && priceMaxCents < priceMinCents) return json(400, { error: 'validation' });

  let secrets: { searchLink: string; visitorSalt: string };
  try {
    secrets = svc.secrets();
  } catch {
    return json(503, { error: 'not_configured' });
  }
  const id = parseSearchRef(ref, secrets.searchLink);
  if (!id) return json(404, { error: 'not_found' });
  const rec = await svc.store.getSearch(id).catch(() => null);
  if (!rec?.features) return json(404, { error: 'expired', message: 'These results have expired.' });

  const ip = clientIp(req.headers);
  const human = await svc.verifyHuman(parsed.data.turnstileToken, ip);
  if (human === 'failed') return json(403, { error: 'human_check_failed', message: 'Please try again.' });
  if (svc.limitsEnforced) {
    const visitor = visitorHash(ip, req.headers.get('user-agent') ?? '', secrets.visitorSalt);
    const { key, tier } = limitKey(user, visitor);
    const units = human === 'unavailable' ? 2 : 1; // half a search
    for (const bucket of ['search', 'search_day'] as Bucket[]) {
      const r = await svc.limiter.check(bucket, key, tier, units);
      if (!r.ok)
        return json(
          429,
          { error: 'rate_limited', retryAfterSec: r.retryAfterSec, message: 'Search limit reached.' },
          { 'retry-after': String(r.retryAfterSec ?? 60) },
        );
    }
  }

  const profile = rec.features;
  const shown = new Set(parsed.data.exclude.map((f) => f.toLowerCase()));
  const shownLabels = new Set([...shown].map((f) => f.split('.')[0]!));
  const book = svc.prices.get();
  return eventStream(async (sink) => {
    const started = Date.now();
    sink.send('progress', { stage: 'names', pct: 30 });
    try {
      const names = await runNames({
        description,
        preferences,
        profile,
        strictBrand: false,
        searchId: id,
        seed: `${cacheKey(description, preferences)}:more:${priceMinCents}-${priceMaxCents ?? 'max'}`,
        jev: svc.jev,
        live: !svc.env.MOCK_EXTERNALS,
        wordCache: svc.wordCache,
        exclude: shownLabels,
        bandTlds: (pool) => tldsInBand(priceMinCents, priceMaxCents, pool, book),
      });
      if (names.degraded) sink.send('degraded', { reason: names.degraded });
      const verified = await streamVerify(sink, svc, {
        names,
        profile,
        includeFree: preferences.includeFree && priceMinCents === 0,
        allowHyphens: preferences.allowHyphens,
        keep: (item) => !shown.has(item.fqdn) && inBand(item, priceMinCents, priceMaxCents, basis),
      });
      sink.send('done', {
        counts: verified.counts,
        sections: verified.stored.sections,
        durationMs: Date.now() - started,
        dataAgeHours: verified.dataAgeHours,
      });
      log.info({ event: 'search.more', searchId: id, results: verified.stored.results.length });
    } catch (e) {
      log.error({ event: 'search.more_failed', searchId: id, error: (e as Error).message });
      sink.send('error', { error: 'internal', message: 'Something went wrong. Please try again.' });
    }
  });
}
