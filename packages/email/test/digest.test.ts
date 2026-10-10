// Spec 011 tech §11 `digest.test.ts`: grouping, priority ordering, headers (FR-ACC-008, 014, 016).
import { describe, expect, it } from 'vitest';
import { buildDigest, orderItems, sendDigest, sendingOrder, unsubscribeHeaders } from '../src';

const site = { name: 'Domain_Trail', origin: 'https://domain-trail.vercel.app' };

describe('digest', () => {
  it('lists registered and available names first, each once', () => {
    const items = orderItems([
      { kind: 'price_change', fqdn: 'b.shop' },
      { kind: 'registered', fqdn: 'a.com' },
      { kind: 'registered', fqdn: 'a.com' },
      { kind: 'available', fqdn: 'c.in' },
    ]);
    expect(items.map((i) => `${i.kind}:${i.fqdn}`)).toEqual([
      'registered:a.com',
      'available:c.in',
      'price_change:b.shop',
    ]);
  });

  it('is one digest with a link to the account and an unsubscribe link', () => {
    const d = buildDigest(
      site,
      [{ kind: 'registered', fqdn: 'sunnycrust.shop' }],
      'https://x/api/unsubscribe?token=t',
    );
    expect(d.subject).toBe('Domain_Trail: sunnycrust.shop was registered by someone.');
    expect(d.text).toContain('https://domain-trail.vercel.app/account');
    expect(d.text).toContain('Stop these e-mails: https://x/api/unsubscribe?token=t');
    const many = buildDigest(
      site,
      [
        { kind: 'available', fqdn: 'a.com' },
        { kind: 'available', fqdn: 'b.com' },
      ],
      'u',
    );
    expect(many.subject).toBe('Domain_Trail: 2 changes to names you watch');
  });

  it('sends urgent digests first when capacity is short', () => {
    const order = sendingOrder([
      { id: 'later', items: [{ kind: 'price_change' as const, fqdn: 'a.com' }] },
      { id: 'first', items: [{ kind: 'available' as const, fqdn: 'b.com' }] },
    ]);
    expect(order.map((u) => u.id)).toEqual(['first', 'later']);
  });

  it('adds RFC 8058 one-click headers', async () => {
    expect(unsubscribeHeaders('https://x/u?t=1')).toEqual({
      'List-Unsubscribe': '<https://x/u?t=1>',
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    });
    let body: Record<string, unknown> = {};
    const fetchFn = (async (_u: unknown, init?: RequestInit) => {
      body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response('{}');
    }) as typeof fetch;
    const out = await sendDigest(
      { apiKey: 'k', from: 'alerts@example.com', fetchFn },
      'u@example.com',
      { subject: 's', text: 't' },
      'https://x/u',
    );
    expect(out).toBe('sent');
    expect(body.headers).toEqual(unsubscribeHeaders('https://x/u'));
  });
});
