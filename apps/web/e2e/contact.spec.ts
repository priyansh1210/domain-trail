// Spec 013 `contact.spec.ts` (FR-PRIV-007): the contact page shows the grievance contact and accepts a message,
// which the owner then sees on /ops.
import { expect, test } from '@playwright/test';
import { signIn } from './helpers';

test('a visitor can send a message, and the owner reads it on /ops', async ({ page, browser }) => {
  await page.goto('/contact');
  await expect(page.getByText('Grievance contact: Priyansh K — priyansh1210@gmail.com')).toBeVisible();
  const note = `Please delete my data ${Date.now()}`;
  await page.getByLabel('Your e-mail address').fill('visitor@example.com');
  await page.getByLabel('Message').fill(note);
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByText('your message has arrived')).toBeVisible();

  const owner = await (await browser.newContext()).newPage();
  await signIn(owner, 'Google', '/');
  await owner.goto('/ops');
  await expect(owner.getByTestId('contact-messages')).toContainText(note);
});

test('the full policies are published with their version', async ({ page }) => {
  await page.goto('/privacy');
  await expect(page.getByRole('heading', { level: 1, name: 'Privacy Policy' })).toBeVisible();
  await expect(page.getByText(/Version v1, effective/)).toBeVisible();
  await expect(
    page.getByText('Saved items are stored on our servers and can be seen by the site operator.'),
  ).toBeVisible();
  await page.goto('/terms');
  await expect(page.getByRole('heading', { level: 2, name: 'Trademarks' })).toBeVisible();
});
