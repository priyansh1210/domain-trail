// Spec 015 / 013 `sentry-scrub.test.ts` equivalent (FR-OBS-009, FR-PRIV-004): error events carry no personal data
// and nothing is sent without a DSN.
import { describe, expect, it } from 'vitest';
import { errorEvent, parseDsn, reportError } from './errors';

const DSN = 'https://abc123@o42.ingest.sentry.io/4507';

describe('error reports', () => {
  it('parses a DSN', () => {
    expect(parseDsn(DSN)).toEqual({ host: 'o42.ingest.sentry.io', projectId: '4507', publicKey: 'abc123' });
    expect(parseDsn('not a url')).toBeNull();
    expect(parseDsn(undefined)).toBeNull();
  });

  it('removes e-mail addresses and IPs from the message and keeps only whitelisted fields', () => {
    const ev = errorEvent(new Error('lookup failed for jane@example.com from 203.0.113.9'), {
      route: '/api/me/watchlist/[fqdn]',
      method: 'POST',
    });
    const text = JSON.stringify(ev);
    expect(text).not.toContain('jane@example.com');
    expect(text).not.toContain('203.0.113.9');
    expect(Object.keys(ev).sort()).toEqual([
      'event_id',
      'exception',
      'level',
      'platform',
      'tags',
      'timestamp',
    ]);
    expect(ev.tags).toEqual({ route: '/api/me/watchlist/[fqdn]', method: 'POST' });
  });

  it('sends nothing without a DSN, and one envelope with one', async () => {
    const calls: Array<{ url: string; body: string; auth: string | null }> = [];
    const fetchFn = (async (u: string | URL | Request, init?: RequestInit) => {
      calls.push({
        url: String(u),
        body: String(init?.body),
        auth: new Headers(init?.headers).get('x-sentry-auth'),
      });
      return new Response('{}');
    }) as typeof fetch;
    expect(await reportError(new Error('x'), {}, {}, fetchFn)).toBe('off');
    expect(calls).toHaveLength(0);
    expect(await reportError(new Error('x'), {}, { SENTRY_DSN: DSN }, fetchFn)).toBe('sent');
    expect(calls[0]!.url).toBe('https://o42.ingest.sentry.io/api/4507/envelope/');
    expect(calls[0]!.auth).toContain('sentry_key=abc123');
    expect(calls[0]!.body.split('\n')).toHaveLength(3);
  });
});
