// Spec 015 tech §11 `alert-dedupe.test.ts`: once per 6 h per key (FR-OBS-010).
import { describe, expect, it } from 'vitest';
import { MemoryDedupe, sendAlert } from '../src';

const cfg = {
  channel: 'email' as const,
  siteName: 'Site',
  resendApiKey: 're_x',
  ownerEmail: 'owner@example.com',
};
const ok = (async () => new Response('{}', { status: 200 })) as typeof fetch;

describe('alert de-duplication', () => {
  it('sends a key once per window, then again after it', async () => {
    let t = 0;
    const dedupe = new MemoryDedupe(() => t);
    const alert = { level: 'warning' as const, key: 'job-failed-twice:x', message: 'x failed twice' };
    expect(await sendAlert(alert, cfg, { dedupe, fetchFn: ok })).toBe('sent');
    t += 5 * 3600_000;
    expect(await sendAlert(alert, cfg, { dedupe, fetchFn: ok })).toBe('deduped');
    t += 1.5 * 3600_000;
    expect(await sendAlert(alert, cfg, { dedupe, fetchFn: ok })).toBe('sent');
  });

  it('keeps different keys apart', async () => {
    const dedupe = new MemoryDedupe(() => 0);
    const a = { level: 'critical' as const, key: 'a', message: 'a' };
    const b = { level: 'critical' as const, key: 'b', message: 'b' };
    expect(await sendAlert(a, cfg, { dedupe, fetchFn: ok })).toBe('sent');
    expect(await sendAlert(b, cfg, { dedupe, fetchFn: ok })).toBe('sent');
  });

  it('only logs info alerts', async () => {
    const dedupe = new MemoryDedupe(() => 0);
    expect(await sendAlert({ level: 'info', key: 'i', message: 'i' }, cfg, { dedupe, fetchFn: ok })).toBe(
      'logged',
    );
  });
});
