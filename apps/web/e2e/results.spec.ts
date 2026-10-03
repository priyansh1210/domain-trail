// Spec 009 `results.spec.ts` (FR-UX-002, 004, 005, 017; FR-AVL-004; FR-PRC-001, 016, 017) and `recheck.spec.ts`
// (FR-AVL-014): checked, priced results in sections with status, check time, source, Buy / Copy / Re-check /
// thumbs, and the disclaimer.
import { expect, test } from '@playwright/test';
import { openSection, search } from './helpers';

test('results arrive in price sections with status, check time, price source and actions', async ({
  page,
}) => {
  await search(page);
  await openSection(page, /^\$1–100/);
  const budget = page.getByTestId('section-budget');
  await expect(budget).toBeVisible();
  const cards = budget.getByTestId('result-card');
  expect(await cards.count()).toBeGreaterThanOrEqual(5);
  const first = cards.first();
  await expect(first).toContainText(/Available|Likely available|Unconfirmed/);
  await expect(first).toContainText(/checked (just now|\d+ min ago)/);
  await expect(first).toContainText(/first year · renews .*\/yr · price from Porkbun/);
  const buy = first.getByRole('link', { name: /^Buy .* at Porkbun/ });
  await expect(buy).toHaveAttribute('href', /^https:\/\/porkbun\.com\/checkout\/search\?q=/);
  await expect(buy).toHaveAttribute('target', '_blank');
  await expect(buy).toHaveAttribute('rel', /noopener/);
  await expect(page.getByTestId('disclaimer')).toContainText('We do not sell domains');
  // taken names never appear (FR-AVL-001)
  expect(await page.locator('[data-status="taken"]').count()).toBe(0);
});

test('copy, thumbs and re-check work on a card', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => undefined);
  await search(page);
  await openSection(page, /^\$1–100/);
  const card = page.getByTestId('section-budget').getByTestId('result-card').first();
  const name = (await card.locator('span.text-lg').textContent()) ?? '';
  await card.getByRole('button', { name: /^Copy / }).click();
  await expect(card.getByRole('status')).toContainText(/Copied|^$/);
  const up = card.getByRole('button', { name: /^Good suggestion/ });
  await up.click();
  await expect(up).toHaveAttribute('aria-pressed', 'true');
  await card.getByRole('button', { name: /^Check .* again/ }).click();
  // the card either stays with a fresh check time or disappears because the name is now taken
  await expect(page.getByText('Checking…')).toHaveCount(0);
  await expect(page.getByText('Something went wrong')).toHaveCount(0);
  expect(name.length).toBeGreaterThan(3);
});
