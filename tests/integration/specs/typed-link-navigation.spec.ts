// SPEC §6.4 + §8: typed links lower to readable href attributes and navigate
// by loading the target document.
import { expect, test } from '@kovojs/test/integration';

test.use({ kovoFixture: 'typed-link-navigation' });

test('Link() and href() produce plain anchors with path and search params', async ({ page }) => {
  await page.goto('/');

  const product = page.locator('#product-link');
  await expect(product).toHaveAttribute('href', '/products/sku-1?ref=home&sort=price+asc');
  await expect(page.locator('#search-link')).toHaveAttribute('href', '/search?q=boots+%26+socks');

  await Promise.all([
    page.waitForURL('**/products/sku-1?ref=home&sort=price+asc'),
    product.click(),
  ]);
  await expect(page.getByRole('heading', { name: 'Product sku-1' })).toBeVisible();
  await expect(page.locator('[data-route="product"]')).toHaveText('home:price asc');

  await page.goto('/');
  await page.locator('#search-link').click();
  await expect(page).toHaveURL(/\/search\?q=boots\+%26\+socks$/);
  await expect(page.locator('[data-route="search"]')).toHaveText('boots & socks');
});
