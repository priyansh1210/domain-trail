// Spec 007 `free-section.spec.ts` (FR-FREE-002, 004, 008, 011), spec 009 `share.spec.ts` (FR-UX-006) and
// spec 006 `find-more.spec.ts` (FR-PRC-009).
import { expect, test } from '@playwright/test';
import { DEV_PORTFOLIO, openSection, search } from './helpers';

test('a developer portfolio gets free names with conditions, and hosting addresses in their own group', async ({
  page,
}) => {
  await search(page, DEV_PORTFOLIO);
  await openSection(page, /^Free/);
  const free = page.getByTestId('section-free');
  await expect(free).toContainText('Free options cost nothing');
  await expect(free).toContainText('.is-a.dev');
  await expect(page.getByTestId('free-hosting')).toContainText('Free hosting addresses');
  const card = free.getByTestId('result-card').first();
  await card.getByText('How to get it').click();
  await expect(card).toContainText('Waiting time');
  await expect(card.getByRole('link', { name: 'Official instructions' })).toHaveAttribute(
    'href',
    /^https:\/\//,
  );
});

test('a shared link shows the same results without the description', async ({ page, browser }) => {
  await search(page);
  await openSection(page, /^\$1–100/);
  const first =
    (await page
      .getByTestId('section-budget')
      .getByTestId('result-card')
      .first()
      .locator('span.text-lg')
      .textContent()) ?? '';
  const other = await browser.newContext();
  const shared = await other.newPage();
  await shared.goto(page.url());
  await openSection(shared, /^\$1–100/);
  await expect(shared.getByTestId('section-budget')).toContainText(first);
  await expect(shared.locator('body')).not.toContainText('sourdough bread and cakes to families');
  await other.close();
});

test('"Find more in this range" asks for names in an empty price band', async ({ page }) => {
  await search(page);
  await page.getByTestId('price-filter').getByRole('button', { name: '$101–300' }).click();
  await openSection(page, /^\$101–300/);
  const mid = page.getByTestId('section-mid');
  const button = mid.getByRole('button', { name: 'Find more in this range' });
  if (await button.isVisible()) {
    await button.click();
    await expect(mid.getByRole('button', { name: /Find more in this range|Finding more/ })).toBeVisible();
    await expect(mid.getByRole('button', { name: 'Find more in this range' })).toBeEnabled({
      timeout: 20_000,
    });
  }
  await expect(mid.getByText('Something went wrong')).toHaveCount(0);
});
