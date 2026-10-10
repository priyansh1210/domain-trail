// Alert digests and unsubscribe links (spec 011 tech §4, §5.3; FR-ACC-008, 009, 014, 016). Only one kind of e-mail
// exists: the alert digest a user asked for. Nothing is sent while EMAIL_MODE=off (owner decision 2026-10-03); the
// code is here so switching it on later is configuration only.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { timedFetch } from '@domains-all/config/net';

export type DigestKind = 'registered' | 'available' | 'dropping_soon' | 'price_change';

export interface DigestItem {
  kind: DigestKind;
  fqdn: string;
}

const LINE: Record<DigestKind, (name: string) => string> = {
  registered: (n) => `${n} was registered by someone.`,
  available: (n) => `${n} is available now.`,
  dropping_soon: (n) => `${n} may become available soon.`,
  price_change: (n) => `The price of ${n} changed.`,
};

/** Registered/available first (they matter most), then the rest, each name once per kind. */
export function orderItems(items: readonly DigestItem[]): DigestItem[] {
  const rank: Record<DigestKind, number> = { registered: 0, available: 0, dropping_soon: 1, price_change: 2 };
  const seen = new Set<string>();
  return [...items]
    .sort((a, b) => rank[a.kind] - rank[b.kind] || a.fqdn.localeCompare(b.fqdn))
    .filter((i) => {
      const k = `${i.kind}:${i.fqdn}`;
      return seen.has(k) ? false : (seen.add(k), true);
    });
}

/** Users whose digest has a registered/available item are sent first when capacity is short (FR-ACC-016). */
export function sendingOrder<T extends { items: readonly DigestItem[] }>(users: readonly T[]): T[] {
  const urgent = (u: T) => u.items.some((i) => i.kind === 'registered' || i.kind === 'available');
  return [...users].sort((a, b) => Number(urgent(b)) - Number(urgent(a)));
}

export function buildDigest(
  site: { name: string; origin: string },
  items: readonly DigestItem[],
  unsubscribeUrl: string,
): { subject: string; text: string } {
  const list = orderItems(items);
  const subject =
    list.length === 1
      ? `${site.name}: ${LINE[list[0]!.kind](list[0]!.fqdn)}`
      : `${site.name}: ${list.length} changes to names you watch`;
  const text = [
    'Changes to the names you watch:',
    '',
    ...list.map((i) => `- ${LINE[i.kind](i.fqdn)}`),
    '',
    `Your watchlist: ${site.origin}/account`,
    '',
    `Stop these e-mails: ${unsubscribeUrl}`,
  ].join('\n');
  return { subject, text };
}

const mac = (secret: string, userId: string) =>
  createHmac('sha256', `unsubscribe:${secret}`).update(userId).digest('base64url').slice(0, 32);

/** `base64url(userId).hmac` — contains only the user id; checked without a database lookup. */
export function unsubscribeToken(userId: string, secret: string): string {
  return `${Buffer.from(userId).toString('base64url')}.${mac(secret, userId)}`;
}

export function verifyUnsubscribeToken(token: string, secret: string): string | null {
  const [id64, sig] = token.split('.');
  if (!id64 || !sig) return null;
  const userId = Buffer.from(id64, 'base64url').toString();
  if (!/^[0-9a-f-]{36}$/i.test(userId)) return null;
  const want = Buffer.from(mac(secret, userId));
  const got = Buffer.from(sig);
  return want.length === got.length && timingSafeEqual(want, got) ? userId : null;
}

/** RFC 8058 one-click unsubscribe headers. */
export function unsubscribeHeaders(url: string): Record<string, string> {
  return { 'List-Unsubscribe': `<${url}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' };
}

export async function sendDigest(
  cfg: { apiKey: string; from: string; fetchFn?: typeof fetch },
  to: string,
  digest: { subject: string; text: string },
  unsubscribeUrl: string,
): Promise<'sent' | 'failed'> {
  const res = await timedFetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${cfg.apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      from: cfg.from,
      to: [to],
      subject: digest.subject,
      text: digest.text,
      headers: unsubscribeHeaders(unsubscribeUrl),
    }),
    timeoutMs: 10_000,
    fetchFn: cfg.fetchFn,
  });
  return res?.ok ? 'sent' : 'failed';
}
