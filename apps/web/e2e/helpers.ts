// Shared steps for the end-to-end tests (mock mode, recorded DNS/RDAP answers).
import { expect, type Page } from '@playwright/test';

export const BAKERY = 'Online bakery in Pune delivering sourdough bread and cakes to families';
export const DEV_PORTFOLIO =
  'Personal portfolio of a software developer showing open-source projects and a blog about TypeScript';

/** Runs a search and waits until checked results are on the page. */
export async function search(page: Page, description = BAKERY) {
  await page.goto('/');
  await page.getByLabel('Describe your website').fill(description);
  await page.getByRole('button', { name: 'Find domains' }).click();
  await expect(page.getByTestId('feature-chips')).toBeVisible();
  await expect(page.getByText('✓ Pricing')).toBeVisible({ timeout: 20_000 });
}

/** On phones the sections are tabs; open one before looking inside it. */
export async function openSection(page: Page, name: RegExp) {
  const tab = page.getByRole('tab', { name }).first();
  if (await tab.isVisible()) await tab.click();
}
