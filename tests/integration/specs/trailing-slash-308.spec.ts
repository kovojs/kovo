// SPEC §9.5: trailing slashes produce a 308 to the canonical route URL.
import { expect, test } from '@kovojs/test/integration';

test.use({ kovoFixture: 'trailing-slash-308' });

test('direct request receives 308 and the followed canonical route renders once', async ({
  page,
  request,
}) => {
  const raw = await request.get('/products/p1/?tab=details', { maxRedirects: 0 });
  expect(raw.status()).toBe(308);
  expect(raw.headers().location).toBe('/products/p1?tab=details');

  await page.goto('/products/p1/?tab=details');
  await expect(page).toHaveURL(/\/products\/p1\?tab=details$/);
  await expect(page.getByRole('heading', { name: 'Product p1' })).toBeVisible();
  await expect(page.locator('[data-tab]')).toHaveText('details');
});
