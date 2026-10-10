// Spec 013 `headers.spec.ts` (FR-PRIV-011, NFR-PRIV-001): every page sends the security headers.
import { expect, test } from '@playwright/test';

test('pages send the security headers', async ({ request }) => {
  for (const path of ['/', '/status', '/privacy', '/api/health']) {
    const h = (await request.get(path)).headers();
    expect(h['strict-transport-security'], path).toContain('max-age=63072000');
    expect(h['x-content-type-options'], path).toBe('nosniff');
    expect(h['referrer-policy'], path).toBe('strict-origin-when-cross-origin');
    expect(h['permissions-policy'], path).toContain('camera=()');
    expect(h['cross-origin-opener-policy'], path).toBe('same-origin');
    const csp = h['content-security-policy'] ?? '';
    for (const part of [
      "default-src 'self'",
      "frame-ancestors 'none'",
      "object-src 'none'",
      "base-uri 'none'",
      "form-action 'self'",
      'frame-src https://challenges.cloudflare.com',
    ])
      expect(csp, `${path}: ${part}`).toContain(part);
    expect(h['x-powered-by'], path).toBeUndefined();
  }
});
