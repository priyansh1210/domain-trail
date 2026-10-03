// Spec 009 `a11y.spec.ts` (FR-UX-013, NFR-UX-004) and `seo.spec.ts` (FR-UX-016) for the pages that exist in M2:
// no serious or critical axe violations; result pages are not indexed.
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

async function noSeriousViolations(page: Page) {
  const { violations } = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
    .analyze();
  const serious = violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
}

for (const path of ['/', '/privacy', '/terms']) {
  test(`${path} has no serious accessibility problems`, async ({ page }) => {
    await page.goto(path);
    await noSeriousViolations(page);
  });
}

test('the results page has no serious accessibility problems and is not indexed', async ({ page }) => {
  await page.goto('/');
  await page
    .getByLabel('Describe your website')
    .fill('Online bakery in Pune delivering sourdough bread and cakes');
  await page.getByRole('button', { name: 'Find domains' }).click();
  await expect(page.getByTestId('feature-chips')).toBeVisible();
  await noSeriousViolations(page);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
});
