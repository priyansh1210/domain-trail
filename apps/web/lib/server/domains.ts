// POST /api/domains/{fqdn}/recheck (spec 005 FR-AVL-014, NFR-AVL-004) and POST /api/feedback (spec 008 §5.8,
// FR-RANK-012). Both are rate-limited per pseudonymous visitor (spec 014); neither stores personal data.
import { REGISTRABLE, splitFqdn } from '@domains-all/availability';
import { parseSearchRef } from '@domains-all/core';
import { log } from '@domains-all/log';
import { priceFor } from '@domains-all/pricing';
import * as z from 'zod/mini';
import type { Services } from './services';
import { readLimited } from './sse';
import { clientIp, visitorHash } from './visitor';

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  Response.json(body, { status, headers: { 'cache-control': 'no-store', ...headers } });

/** label.tld or label.sld.tld built from letters, digits and hyphens only. */
const FQDN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9-]{2,63}){1,2}$/;

async function limited(
  req: Request,
  svc: Services,
  bucket: 'recheck' | 'feedback',
): Promise<Response | null> {
  if (!svc.limitsEnforced) return null;
  let salt: string;
  try {
    salt = svc.secrets().visitorSalt;
  } catch {
    return json(503, { error: 'not_configured' });
  }
  const visitor = visitorHash(clientIp(req.headers), req.headers.get('user-agent') ?? '', salt);
  const r = await svc.limiter.check(bucket, visitor, 'anonymous', 1);
  return r.ok
    ? null
    : json(
        429,
        { error: 'rate_limited', retryAfterSec: r.retryAfterSec, message: 'Please wait a moment.' },
        { 'retry-after': String(r.retryAfterSec ?? 60) },
      );
}

export async function handleRecheck(req: Request, rawFqdn: string, svc: Services): Promise<Response> {
  const fqdn = decodeURIComponent(rawFqdn).toLowerCase();
  const { label, tld } = splitFqdn(fqdn);
  const book = svc.prices.get();
  if (!FQDN.test(fqdn)) return json(400, { error: 'validation', message: 'Not a domain name we can check.' });
  const blocked = await limited(req, svc, 'recheck');
  if (blocked) return blocked;
  const r = await svc.checker.recheckOne(fqdn);
  log.info({ event: 'recheck', tld, status: r.status });
  const priced = REGISTRABLE.has(r.status) ? priceFor({ label, tld, status: r.status }, book) : undefined;
  return json(200, {
    fqdn,
    status: r.status,
    method: r.method,
    checkedAt: r.checkedAt,
    expiresAt: r.expiresAt,
    ...(priced?.priced
      ? {
          price: {
            upfrontUsdCents: priced.upfrontUsdCents,
            firstYearUsdCents: priced.firstYearUsdCents,
            renewUsdCents: priced.renewUsdCents,
            minYears: priced.minYears,
            source: priced.source,
            buyUrl: priced.buyUrl,
            premium: priced.premium,
            premiumPossible: priced.premiumPossible,
            renewWarning: priced.renewWarning,
          },
        }
      : {}),
  });
}

const FeedbackSchema = z.object({
  searchRef: z.string().check(z.minLength(10), z.maxLength(200)),
  fqdn: z.string().check(z.regex(FQDN)),
  vote: z.union([z.literal(1), z.literal(-1)]),
  reason: z.optional(z.enum(['offensive', 'brand', 'other'])),
});

export async function handleFeedback(req: Request, svc: Services): Promise<Response> {
  const raw = await readLimited(req, 2048);
  if (raw === null) return json(413, { error: 'too_large' });
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return json(400, { error: 'validation' });
  }
  const parsed = FeedbackSchema.safeParse(body);
  if (!parsed.success) return json(400, { error: 'validation' });
  let secrets: { searchLink: string; visitorSalt: string };
  try {
    secrets = svc.secrets();
  } catch {
    return json(503, { error: 'not_configured' });
  }
  const searchId = parseSearchRef(parsed.data.searchRef, secrets.searchLink);
  if (!searchId) return json(404, { error: 'not_found' });
  const blocked = await limited(req, svc, 'feedback');
  if (blocked) return blocked;
  const visitor = visitorHash(
    clientIp(req.headers),
    req.headers.get('user-agent') ?? '',
    secrets.visitorSalt,
  );
  try {
    await svc.feedback.vote({
      searchId,
      fqdn: parsed.data.fqdn,
      visitorHash: visitor,
      vote: parsed.data.vote,
      ...(parsed.data.reason ? { reason: parsed.data.reason } : {}),
    });
  } catch (e) {
    log.warn({ event: 'feedback.not_saved', error: (e as Error).message });
  }
  return new Response(null, { status: 202, headers: { 'cache-control': 'no-store' } });
}
