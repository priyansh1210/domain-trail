// Spec 015 tech §11 `alert-channel.test.ts`: e-mail to the owner's own address, or a chat webhook (FR-OBS-012).
import { describe, expect, it } from 'vitest';
import { MemoryDedupe, RESEND_URL, sendAlert } from '../src';

function recorder() {
  const calls: Array<{ url: string; body: Record<string, unknown>; auth: string | null }> = [];
  const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(input),
      body: JSON.parse(String(init?.body)) as Record<string, unknown>,
      auth: new Headers(init?.headers).get('authorization'),
    });
    return new Response('{}', { status: 200 });
  }) as typeof fetch;
  return { calls, fetchFn };
}

const alert = {
  level: 'warning' as const,
  key: 'job-failed-twice:refresh-prices',
  message: 'refresh-prices failed twice in a row',
  data: { error: 'price list failed the sanity check' },
};

describe('alert channels', () => {
  it('e-mails the owner through Resend', async () => {
    const { calls, fetchFn } = recorder();
    const out = await sendAlert(
      alert,
      { channel: 'email', siteName: 'Domain_Trail', resendApiKey: 're_key', ownerEmail: 'owner@example.com' },
      { dedupe: new MemoryDedupe(), fetchFn },
    );
    expect(out).toBe('sent');
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(RESEND_URL);
    expect(calls[0]!.auth).toBe('Bearer re_key');
    expect(calls[0]!.body).toMatchObject({
      to: ['owner@example.com'],
      subject: '[Domain_Trail] warning: job-failed-twice:refresh-prices',
    });
    expect(String(calls[0]!.body.text)).toContain('error: price list failed the sanity check');
  });

  it('posts to a chat webhook when ALERT_CHANNEL=chat', async () => {
    const { calls, fetchFn } = recorder();
    const out = await sendAlert(
      alert,
      { channel: 'chat', siteName: 'S', webhookUrl: 'https://chat.example/hook' },
      { dedupe: new MemoryDedupe(), fetchFn },
    );
    expect(out).toBe('sent');
    expect(calls[0]!.url).toBe('https://chat.example/hook');
    expect(String(calls[0]!.body.text)).toContain('refresh-prices failed twice');
  });

  it('reports a missing configuration instead of failing', async () => {
    const { calls, fetchFn } = recorder();
    const out = await sendAlert(
      alert,
      { channel: 'email', siteName: 'S' },
      { dedupe: new MemoryDedupe(), fetchFn },
    );
    expect(out).toBe('not_configured');
    expect(calls).toHaveLength(0);
  });

  it('reports a failed send', async () => {
    const fetchFn = (async () => new Response('no', { status: 500 })) as typeof fetch;
    const out = await sendAlert(
      alert,
      { channel: 'email', siteName: 'S', resendApiKey: 'k', ownerEmail: 'o@example.com' },
      { dedupe: new MemoryDedupe(), fetchFn },
    );
    expect(out).toBe('failed');
  });
});
