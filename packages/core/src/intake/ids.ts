// Search ids, share links and the result-cache key (spec 001 tech §4–§9; FR-INT-008, FR-INT-013).
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { PIPELINE_VERSION } from '@domains-all/config';
import { uuidv7 } from 'uuidv7';
import type { Preferences } from './schema';

export const newSearchId = (): string => uuidv7();

/** Preferences in a stable order so the same choices always produce the same key. */
export function canonicalPrefs(p: Preferences): string {
  const sorted = { ...p, preferredTlds: [...p.preferredTlds].sort() } as Record<string, unknown>;
  return JSON.stringify(
    Object.fromEntries(
      Object.keys(sorted)
        .sort()
        .map((k) => [k, sorted[k]]),
    ),
  );
}

export function cacheKey(
  normalizedDescription: string,
  prefs: Preferences,
  version = PIPELINE_VERSION,
): string {
  return createHash('sha256')
    .update(normalizedDescription)
    .update('\u0000')
    .update(canonicalPrefs(prefs))
    .update('\u0000')
    .update(version)
    .digest('hex');
}

const hmac8 = (id: string, secret: string) =>
  createHmac('sha256', secret).update(id).digest('hex').slice(0, 8);

/** `/s/{id}.{hmac8}`: UUIDv7 ids are time-ordered, so the HMAC suffix keeps neighbours unguessable. */
export function searchRef(id: string, secret: string): string {
  return `${id}.${hmac8(id, secret)}`;
}

const REF = /^([0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.([0-9a-f]{8})$/;

/** Returns the search id when the reference is genuine, otherwise null (the route then answers 404). */
export function parseSearchRef(ref: string, secret: string): string | null {
  const m = REF.exec(ref);
  if (!m) return null;
  const [, id, mac] = m;
  const expected = Buffer.from(hmac8(id!, secret));
  const given = Buffer.from(mac!);
  return expected.length === given.length && timingSafeEqual(expected, given) ? id! : null;
}
