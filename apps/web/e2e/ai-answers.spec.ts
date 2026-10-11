// AI answers switch (spec 001 US-7, FR-INT-015; spec 002 FR-JEV-018): locked for signed-out visitors, with a
// sign-in link that keeps the description; off by default once signed in; the choice is remembered on this browser.
import { expect, type Page, test } from '@playwright/test';
import { asNewUser, BAKERY, signIn } from './helpers';

const aiSwitch = (page: Page) => page.getByTestId('ai-answers').getByRole('switch', { name: 'AI answers' });

/** Submits the form and returns the preferences the browser sent. */
async function submit(page: Page): Promise<Record<string, unknown>> {
  const request = page.waitForRequest((r) => r.url().endsWith('/api/search') && r.method() === 'POST');
  await page.getByRole('button', { name: 'Find domains' }).click();
  return (await request).postDataJSON().preferences as Record<string, unknown>;
}

test('signed-out visitors see the switch locked and search with the built-in rules', async ({ page }) => {
  await page.goto('/');
  await expect(aiSwitch(page)).toBeDisabled();
  await expect(aiSwitch(page)).toHaveAttribute('aria-checked', 'false');
  await expect(page.getByRole('link', { name: /Sign in to use AI answers/ })).toBeVisible();
  await page.getByLabel('Describe your website').fill(BAKERY);
  expect((await submit(page)).aiAnswers).toBe(false);
  await expect(page.locator('[data-step="pricing"][data-state="done"]')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/decision model is unavailable/)).toHaveCount(0);
});

test('signing in from the switch keeps the text; signed-in users switch AI answers on', async ({
  page,
  context,
  baseURL,
}) => {
  await page.goto('/');
  await page.getByLabel('Describe your website').fill(BAKERY);
  await page.getByRole('link', { name: /Sign in to use AI answers/ }).click();
  await expect(page).toHaveURL(/\/sign-in\?next=%2F$/);

  await asNewUser(context, baseURL);
  await signIn(page, 'Google', '/');
  if (new URL(page.url()).pathname !== '/') await page.goto('/');
  await expect(page.getByLabel('Describe your website')).toHaveValue(BAKERY);

  await expect(aiSwitch(page)).toBeEnabled();
  await expect(aiSwitch(page)).toHaveAttribute('aria-checked', 'false');
  await aiSwitch(page).click();
  await expect(aiSwitch(page)).toHaveAttribute('aria-checked', 'true');
  await page.reload();
  await expect(aiSwitch(page)).toHaveAttribute('aria-checked', 'true');

  await page.getByLabel('Describe your website').fill(BAKERY);
  expect((await submit(page)).aiAnswers).toBe(true);
  await expect(page.locator('[data-step="pricing"][data-state="done"]')).toBeVisible({ timeout: 20_000 });
});
