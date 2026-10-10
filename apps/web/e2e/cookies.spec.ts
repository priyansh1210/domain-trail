// Spec 013 `cookies.spec.ts` (FR-PRIV-003): no cookies for a visitor who only searches; the first save sets only the
// session cookie it needs.
import { expect, test } from '@playwright/test';
import { search } from './helpers';

test('searching sets no cookies; saving sets only the session cookie', async ({ page, context }) => {
  await search(page);
  expect(await context.cookies()).toEqual([]);
  await page.getByRole('button', { name: /Save search/ }).click();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByTestId('saved-search')).toBeVisible();
  const cookies = await context.cookies();
  expect(cookies.map((c) => c.name)).toEqual(['da_mock_session']);
  expect(cookies[0]).toMatchObject({ httpOnly: true, sameSite: 'Lax' });
});
