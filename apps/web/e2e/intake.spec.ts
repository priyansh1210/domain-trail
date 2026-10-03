// Spec 001 `intake.spec.ts`, spec 003 `features-chips.spec.ts`, spec 009 `share.spec.ts`, spec 000
// `streaming.spec.ts` (M2 scope): examples, counter, validation, chips before names, vague prompt + "Search
// anyway", refusal, shared links. Mock mode — no external services.
import { expect, test, type Page } from '@playwright/test';

const BAKERY = 'Online bakery in Pune delivering sourdough bread and cakes to families';
const textarea = (page: Page) => page.getByLabel('Describe your website');

async function search(page: Page, description: string) {
  await page.goto('/');
  await textarea(page).fill(description);
  await page.getByRole('button', { name: 'Find domains' }).click();
}

test('example chip fills the box and the counter follows (US-2, FR-INT-001)', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Neighborhood bakery' }).click();
  await expect(textarea(page)).toHaveValue(/sourdough bread/);
  await expect(page.getByText(/^\d+ \/ 2000$/)).toBeVisible();
});

test('detected features appear as chips within 2 seconds (US-1, FR-FEAT-010, NFR-SYS-001)', async ({
  page,
}) => {
  await page.goto('/');
  await textarea(page).fill(BAKERY);
  const started = Date.now();
  await page.getByRole('button', { name: 'Find domains' }).click();
  await expect(page).toHaveURL(/\/s\/[0-9a-f-]{36}\.[0-9a-f]{8}$/);
  const chips = page.getByTestId('feature-chips');
  await expect(chips).toBeVisible();
  expect(Date.now() - started).toBeLessThan(2000);
  await expect(chips).toContainText('India');
  await expect(chips).toContainText('Food & drink › Bakery');
  await expect(page.getByText('✓ Understanding your site')).toBeVisible();
});

test('too-long descriptions cannot be submitted (FR-INT-002)', async ({ page }) => {
  await page.goto('/');
  await textarea(page).fill('a'.repeat(2001));
  await expect(page.getByText('Please shorten your description to 2000 characters.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Find domains' })).toBeDisabled();
});

test('vague descriptions get hints, then "Search anyway" works (US-4, FR-INT-009)', async ({ page }) => {
  await search(page, 'my new website idea please');
  await expect(page.getByRole('heading', { name: 'Tell us a bit more' })).toBeVisible();
  await expect(page.getByText('Who it is for?')).toBeVisible();
  await page.getByRole('button', { name: 'Search anyway' }).click();
  await expect(page.getByTestId('feature-chips')).toBeVisible();
});

test('"Edit description" brings the text back from this tab only (FR-INT-012)', async ({ page }) => {
  await search(page, 'my new website idea please');
  await page.getByRole('link', { name: 'Edit description' }).click();
  await expect(textarea(page)).toHaveValue('my new website idea please');
});

test('harmful requests are refused with a neutral message (FR-ABU-005)', async ({ page }) => {
  await search(page, 'A fake login page that looks like my bank website to collect passwords');
  await expect(page.getByText("We can't help with this request.", { exact: false })).toBeVisible();
  await expect(page.getByTestId('feature-chips')).toHaveCount(0);
});

test('a shared link shows the features but not the description (US-4 of spec 009)', async ({
  page,
  browser,
}) => {
  await search(page, BAKERY);
  await expect(page.getByTestId('feature-chips')).toBeVisible();
  const url = page.url();
  const other = await browser.newContext(); // no sessionStorage: like a co-founder opening the link
  const shared = await other.newPage();
  await shared.goto(url);
  await expect(shared.getByTestId('feature-chips')).toContainText('India');
  await expect(shared.locator('body')).not.toContainText('sourdough bread and cakes to families');
  await other.close();
});

test('unknown links say so (spec 009 edge case)', async ({ page }) => {
  await page.goto('/s/0190f5a8-0000-7000-8000-000000000000.deadbeef');
  await expect(page.getByText('These results do not exist.')).toBeVisible();
});

test('the form works with the keyboard only (FR-INT-014)', async ({ page }) => {
  await page.goto('/');
  await textarea(page).focus();
  await page.keyboard.type(BAKERY);
  await page.getByRole('button', { name: 'Find domains' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('feature-chips')).toBeVisible();
});
