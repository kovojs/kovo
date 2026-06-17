// SPEC.md §9.5: built assets are served as immutable static files while app
// routes continue through the Kovo request shell.
import { expect, test } from '@kovojs/test/internal/integration';

test.use({ kovoFixture: 'asset-serving' });

test('serves fixture dist assets without taking over app routes', async ({ page, request }) => {
  const asset = await request.get('/assets/shell.css');
  expect(asset.status()).toBe(200);
  expect(asset.headers()['cache-control']).toBe('public, max-age=31536000, immutable');
  expect(asset.headers()['content-type']).toBe('text/css; charset=utf-8');
  expect(await asset.text()).toContain('.asset-serving');

  const response = await page.goto('/');
  expect(response?.status()).toBe(200);
  await expect(page).toHaveTitle('Asset Serving');
  await expect(page.getByRole('heading', { name: 'Asset Serving' })).toBeVisible();
  await expect(page.locator('.asset-serving')).toHaveText('Route still dispatched');
});
