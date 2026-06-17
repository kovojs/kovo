// SPEC §6.4 and §9.5: notFound() and request-shell misses render configured
// 404 shells; SPEC §9.2 keeps unexpected route failures behind a safe 500 shell.
import { expect, test } from '@kovojs/test/internal/integration';

test.use({ kovoFixture: 'not-found-error-shells' });

test('missing routes render the configured 404 shell', async ({ page }) => {
  const response = await page.goto('/missing');
  expect(response?.status()).toBe(404);

  await expect(page.getByRole('heading', { name: 'Custom missing' })).toBeVisible();
  await expect(page.locator('[data-error-shell="404"]')).toHaveText('Custom missing404:/missing');
});

test('route-returned notFound renders the configured 404 shell', async ({ page }) => {
  const response = await page.goto('/products/absent');
  expect(response?.status()).toBe(404);

  await expect(page.getByRole('heading', { name: 'Custom missing' })).toBeVisible();
  await expect(page.locator('[data-error-shell="404"]')).toHaveText(
    'Custom missing404:/products/absent',
  );
});

test('unexpected page errors render the configured 500 shell without internals', async ({
  page,
}) => {
  const response = await page.goto('/broken');
  expect(response?.status()).toBe(500);

  await expect(page.getByRole('heading', { name: 'Custom failure' })).toBeVisible();
  await expect(page.locator('[data-error-shell="500"]')).toHaveText('Custom failure500:safe');
  await expect(page.locator('body')).not.toContainText('private integration route detail');
});
