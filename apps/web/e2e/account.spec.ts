// Spec 011 `account.spec.ts` (FR-ACC-002, 003, 004, 005, 010, 011, 012, 013, 015, 017, 018) and spec 003 chip
// editing (FR-FEAT-011), with the mock sign-in provider. Each test signs in as its own fresh account.
import { expect, test } from '@playwright/test';
import { asNewUser, openSection, search, signIn } from './helpers';

test('signed-out visitors can save, and signing in keeps what they saved', async ({
  page,
  context,
  baseURL,
}) => {
  await asNewUser(context, baseURL);
  await search(page);
  await page.getByRole('button', { name: /Save search/ }).click();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Saved in this browser.')).toBeVisible();
  await expect(page.getByTestId('saved-search')).toBeVisible();

  await openSection(page, /^\$1–100/);
  const star = page.getByTestId('section-budget').getByTestId('watch-star').first();
  await star.click();
  await expect(star).toHaveAttribute('aria-pressed', 'true');

  await page.getByTestId('account-link').click();
  await expect(page.getByRole('heading', { level: 1, name: 'Saved items' })).toBeVisible();
  await expect(page.getByTestId('saved-searches').getByRole('listitem')).toHaveCount(1);
  await expect(page.getByTestId('watchlist').getByRole('listitem')).toHaveCount(1);

  await page.getByRole('link', { name: 'Sign in to keep them' }).click();
  await expect(page.getByText('will move into your account')).toBeVisible();
  await page.getByRole('link', { name: 'Continue with Google' }).click();
  await expect(page).toHaveURL(/\/account\/welcome/);
  await page.getByLabel(/I accept the Terms/).check();
  await page.getByLabel('I am 18 or older.').check();
  await page.getByRole('button', { name: 'Create my account' }).click();

  await expect(page.getByRole('heading', { level: 1, name: 'Account' })).toBeVisible();
  await expect(page.getByTestId('saved-searches').getByRole('listitem')).toHaveCount(1);
  await expect(page.getByTestId('watchlist').getByRole('listitem')).toHaveCount(1);
  await expect(page.getByTestId('account-link')).toHaveText('Account');
});

test('settings, export and deleting the account', async ({ page, context, baseURL }) => {
  await asNewUser(context, baseURL);
  await signIn(page, 'GitHub');
  await expect(page.getByRole('heading', { level: 1, name: 'Account' })).toBeVisible();
  await page.getByRole('combobox', { name: /^Alerts/ }).selectOption('weekly');
  await page.getByRole('combobox', { name: /^Currency/ }).selectOption('INR');
  await page.getByRole('button', { name: 'Save settings' }).click();
  await expect(page.getByText('Saved.', { exact: true })).toBeVisible();

  const exported = await page.request.get('/api/me/export');
  expect(exported.headers()['content-disposition']).toContain('attachment');
  expect(await exported.json()).toMatchObject({
    account: { anonymous: false, signInProvider: 'github' },
    profile: { alertsFrequency: 'weekly', currency: 'INR' },
  });

  await page.getByRole('button', { name: 'Delete my account' }).click();
  await page.getByRole('button', { name: 'Yes, delete' }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByTestId('sign-in-link')).toBeVisible();
  expect((await page.request.get('/api/me')).status()).toBe(401);
});

test('signing out', async ({ page, context, baseURL }) => {
  await asNewUser(context, baseURL);
  await signIn(page, 'Google');
  await page.getByRole('button', { name: 'Sign out on all devices' }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByTestId('sign-in-link')).toBeVisible();
});

test('signed-in users can edit the detected features; others are invited to sign in', async ({
  page,
  context,
  baseURL,
}) => {
  await search(page);
  await expect(page.getByRole('link', { name: 'Sign in to edit' })).toBeVisible();

  await asNewUser(context, baseURL);
  await signIn(page, 'Google', '/');
  await search(page);
  const before = page.url();
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  const editor = page.getByTestId('chip-editor');
  await editor.getByLabel('Region').selectOption('country_gb');
  await editor
    .getByRole('button', { name: /Remove/ })
    .first()
    .click();
  await editor.getByRole('button', { name: 'Update results' }).click();
  await expect(page).not.toHaveURL(before);
  await expect(page.getByTestId('feature-chips')).toContainText('United Kingdom');
  await expect(page.getByText('✓ Pricing')).toBeVisible({ timeout: 20_000 });
});
