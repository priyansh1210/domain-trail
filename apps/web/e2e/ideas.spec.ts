// Milestone M3 preview (spec 008, spec 009 US-1/US-2 in part): ranked name ideas with suggested extensions and
// reasons, clearly marked as not checked; nothing is called "available" before M4 (constitution P3).
import { expect, test } from '@playwright/test';

const BAKERY = 'Online bakery in Pune delivering sourdough bread and cakes to families';

test('name ideas follow the chips, with extensions, reasons and a "not checked" note', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Describe your website').fill(BAKERY);
  await page.getByRole('button', { name: 'Find domains' }).click();
  await expect(page.getByTestId('feature-chips')).toBeVisible();
  const ideas = page.getByTestId('name-ideas');
  await expect(ideas).toBeVisible();
  expect(await ideas.locator(':scope > li').count()).toBeGreaterThanOrEqual(10);
  await expect(ideas.locator(':scope > li').first()).toContainText(/\.[a-z]{2,}/); // a suggested extension
  await expect(page.getByText('Not checked yet', { exact: false })).toBeVisible();
  await expect(page.getByText('✓ Creating names')).toBeVisible();
  await expect(ideas).not.toContainText(/available/i);
});

test('a shared link shows the same ideas', async ({ page, browser }) => {
  await page.goto('/');
  await page.getByLabel('Describe your website').fill(BAKERY);
  await page.getByRole('button', { name: 'Find domains' }).click();
  const first = await page
    .getByTestId('name-ideas')
    .locator(':scope > li')
    .first()
    .locator('span')
    .first()
    .textContent();
  const other = await browser.newContext();
  const shared = await other.newPage();
  await shared.goto(page.url());
  await expect(shared.getByTestId('name-ideas')).toContainText(first ?? '---');
  await other.close();
});
