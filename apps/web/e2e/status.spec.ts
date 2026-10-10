// Spec 009 `status.spec.ts` (FR-UX-011), spec 010 FR-REF-015, spec 000 FR-SYS-010: the Status page lists every
// dataset with its age, and every page links to it from the footer.
import { expect, test } from '@playwright/test';

test('the Status page shows the age of every dataset and the services', async ({ page }) => {
  await page.goto('/status');
  await expect(page.getByRole('heading', { level: 1, name: 'Status' })).toBeVisible();
  for (const name of [
    'Registration prices',
    'Currency rates',
    'Extensions and registry directory',
    'Newly registered names',
    'Free name providers',
    'Popular sites (brand protection)',
  ])
    await expect(page.getByRole('rowheader', { name })).toBeVisible();
  // Fixture mode: no database, so the daily jobs have not reported.
  await expect(page.getByText('The daily jobs have not reported yet.')).toBeVisible();
  await expect(page.getByText('Search', { exact: true })).toBeVisible();
  await expect(page.getByText(/Majestic Million/)).toBeVisible();
});

test('the footer says how old the domain data is and links to the Status page', async ({ page }) => {
  await page.goto('/');
  const link = page
    .getByRole('contentinfo')
    .getByRole('link', { name: /Domain data (last )?updated .* ago/ });
  await expect(link).toBeVisible();
  await link.click();
  await expect(page).toHaveURL(/\/status$/);
});

test('GET /api/status follows the contract', async ({ request }) => {
  const res = await request.get('/api/status');
  expect(res.ok()).toBe(true);
  const body = (await res.json()) as Record<string, Record<string, unknown>>;
  expect(Object.keys(body.dataAges!).sort()).toEqual([
    'brandList',
    'freeProviders',
    'fx',
    'nrd',
    'prices',
    'tlds',
  ]);
  expect(body.services).toEqual({
    search: expect.any(String),
    decisionModel: 'degraded',
    availability: 'ok',
  });
  expect(res.headers()['cache-control']).toContain('s-maxage=300');
});
