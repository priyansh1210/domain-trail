// Shared steps for the end-to-end tests (mock mode, recorded DNS/RDAP answers).
import { randomUUID } from 'node:crypto';
import { type BrowserContext, expect, type Page } from '@playwright/test';

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

/** The mock sign-in provider signs this browser in as a fresh account (no state shared between tests). */
export async function asNewUser(context: BrowserContext, baseURL: string | undefined) {
  await context.addCookies([
    { name: 'da_mock_as', value: randomUUID(), url: baseURL ?? 'http://localhost:3100' },
  ]);
}

/** Signs in from the sign-in page; accepts the terms the first time. */
export async function signIn(page: Page, provider: 'Google' | 'GitHub', next = '/account') {
  await page.goto(`/sign-in?next=${encodeURIComponent(next)}`);
  await page.getByRole('link', { name: `Continue with ${provider}` }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/auth/') && u.pathname !== '/sign-in');
  if (new URL(page.url()).pathname === '/account/welcome') {
    await page.getByLabel(/I accept the Terms/).check();
    await page.getByLabel('I am 18 or older.').check();
    await page.getByRole('button', { name: 'Create my account' }).click();
  }
}
