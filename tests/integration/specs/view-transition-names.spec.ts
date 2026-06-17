// SPEC.md §8 + KV239: the public render path emits stable view-transition-name CSS
// for matching route templates; duplicate-name rejection remains compiler coverage.
import { expect, test } from '@kovojs/test/internal/integration';

test.use({ kovoFixture: 'view-transition-names' });

async function transitionNames(
  page: import('@kovojs/test/internal/integration').Page,
): Promise<string[]> {
  return page.locator('[data-transition]').evaluateAll((elements) =>
    elements.map((element) => {
      const style = element.getAttribute('style') ?? '';
      const match = /view-transition-name:\s*([^;]+)/.exec(style);
      return match?.[1]?.trim() ?? '';
    }),
  );
}

test('lowers matching viewTransitionName props to stable CSS on both route documents', async ({
  page,
  request,
}) => {
  const homeResponse = await request.get('/');
  expect(homeResponse.status()).toBe(200);
  const homeHtml = await homeResponse.text();
  expect(homeHtml).toContain('view-transition-name: product-photo');
  expect(homeHtml).toContain('view-transition-name: product-title');
  expect(homeHtml).not.toContain('viewTransitionName=');

  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Catalog' })).toBeVisible();
  await expect(page.locator('[data-transition="photo"]')).toHaveAttribute(
    'style',
    'view-transition-name: product-photo',
  );
  await expect(page.locator('[data-transition="title"]')).toHaveAttribute(
    'style',
    'view-transition-name: product-title',
  );
  expect(await transitionNames(page)).toEqual(['product-photo', 'product-title']);

  await Promise.all([page.waitForURL('**/products/sku-1'), page.locator('#product-link').click()]);
  await expect(page.getByRole('heading', { name: 'Trail Pack' })).toBeVisible();
  expect(await transitionNames(page)).toEqual(['product-photo', 'product-title']);
});
