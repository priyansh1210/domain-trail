// Pseudonymous visitor key (spec 012 tech §5.6, FR-DATA-011, FR-PRIV-005): HMAC of IP + browser with a salt that
// changes every UTC day. Never stored, never reversible to an IP without the secret.
import { createHmac } from 'node:crypto';

export function visitorHash(ip: string, userAgent: string, secret: string, now = new Date()): string {
  const dailySalt = createHmac('sha256', secret).update(now.toISOString().slice(0, 10)).digest();
  return createHmac('sha256', dailySalt).update(`${ip}|${userAgent}`).digest('base64url').slice(0, 32);
}

/** First address in x-forwarded-for (set by the hosting platform), else x-real-ip. */
export function clientIp(headers: Headers): string {
  return headers.get('x-forwarded-for')?.split(',')[0]?.trim() || headers.get('x-real-ip') || '0.0.0.0';
}
