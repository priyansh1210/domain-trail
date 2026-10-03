// Spec 006 `price-range.spec.ts` (FR-PRC-004…008, 018; NFR-PRC-003) and `currency.spec.ts` (FR-PRC-010):
// presets, typed values, URL persistence, keyboard, and prices in another currency.
import { expect, test } from '@playwright/test';
import { openSection, search } from './helpers';

test('presets and typed values filter results, and the page address remembers the range', async ({
  page,
}) => {
  await search(page);
  const filter = page.getByTestId('price-filter');
  await filter.getByRole('button', { name: '$101–300' }).click();
  await expect(page).toHaveURL(/min=100\.01/);
  await openSection(page, /^\$1–100/);
  await expect(page.getByTestId('section-budget')).toContainText(/Nothing here matches|No available names/);

  await filter.getByRole('button', { name: 'All', exact: true }).click();
  await filter.getByLabel('Maximum price (USD)').fill('15');
  await filter.getByLabel('Maximum price (USD)').press('Enter');
  await expect(page).toHaveURL(/max=15/);
  await openSection(page, /^\$1–100/);
  const prices = await page.getByTestId('section-budget').getByTestId('price').allTextContents();
  expect(prices.length).toBeGreaterThan(0);
  for (const p of prices) expect(Number(p.replace(/[^\d.]/g, ''))).toBeLessThanOrEqual(15);

  await page.reload();
  await expect(page.getByTestId('price-filter').getByLabel('Maximum price (USD)')).toHaveValue('15');
});

test('the range handles work with the keyboard and announce their values', async ({ page }) => {
  await search(page);
  const min = page.getByRole('slider', { name: 'Minimum price' });
  await min.focus();
  await page.keyboard.press('End');
  await expect(min).toHaveAttribute('aria-valuetext', /Minimum/);
  await expect(page).toHaveURL(/min=/);
});

test('prices, quick ranges and the slider can be shown in yen, marked approximate', async ({ page }) => {
  await search(page);
  await page.getByTestId('price-filter').getByLabel('Currency').selectOption('JPY');
  await openSection(page, /¥/);
  await expect(page.getByTestId('section-budget').getByTestId('price').first()).toContainText('≈ ¥');
  await expect(page.getByTestId('price-filter')).toContainText('approximate');
  await expect(page.getByTestId('price-filter').getByRole('button', { name: /≈ ¥/ }).first()).toBeVisible();
  await page.reload();
  await expect(page.getByTestId('price-filter').getByLabel('Currency')).toHaveValue('JPY');
});

test.describe('visitors in Japan', () => {
  test.use({ locale: 'ja-JP' });
  test('see yen by default', async ({ page }) => {
    await search(page);
    await expect(page.getByTestId('price-filter').getByLabel('Currency')).toHaveValue('JPY');
  });
});
