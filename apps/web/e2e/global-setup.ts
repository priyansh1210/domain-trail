// Warms the test server once before the tests (the first search loads the language model and word lists, which
// can take several seconds on a busy machine and made timing-sensitive tests flaky).
import type { FullConfig } from '@playwright/test';

export default async function globalSetup(config: FullConfig): Promise<void> {
  const base = config.projects[0]?.use.baseURL ?? 'http://localhost:3100';
  await fetch(`${base}/api/search`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      description: 'Warm-up search for a small online plant nursery in Goa',
      turnstileToken: 'none',
      clientRequestId: crypto.randomUUID(),
    }),
  })
    .then((r) => r.text())
    .catch(() => undefined);
}
