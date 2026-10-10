// Spec 011 `admin-view.spec.ts` (FR-ACC-020) and spec 015 `ops-auth.spec.ts` (FR-OBS-005): the owner sees the
// saved-items view and the jobs page; everyone else gets "not found". In the tests the demo Google account is the
// owner (ADMIN_USER_IDS in playwright.config.ts) and the demo GitHub account is not.
import { expect, test } from '@playwright/test';
import { signIn } from './helpers';

for (const path of ['/ops', '/ops/saved']) {
  test(`${path} is not found when signed out`, async ({ page }) => {
    const res = await page.goto(path);
    expect(res?.status()).toBe(404);
  });

  test(`${path} is not found for a signed-in user who is not the owner`, async ({ page }) => {
    await signIn(page, 'GitHub', '/');
    const res = await page.goto(path);
    expect(res?.status()).toBe(404);
  });
}

test('the owner sees saved items and job runs', async ({ page }) => {
  await signIn(page, 'Google', '/');
  const saved = await page.goto('/ops/saved');
  expect(saved?.status()).toBe(200);
  await expect(page.getByRole('heading', { level: 1, name: 'Saved items' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Accounts' })).toBeVisible();
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
  await page.getByRole('link', { name: 'Jobs and budgets' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Owner' })).toBeVisible();
  await expect(page.getByText('No database is connected')).toBeVisible();
});
