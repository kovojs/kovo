import { expect, test } from '@kovojs/test/internal/integration';

test.use({ kovoFixture: 'table-level-invalidation' });

test('re-runs every visible product query instance when a coarse table-level invalidation fires', async ({
  page,
  kovoApp,
}) => {
  await page.goto('/');
  await expect(page.locator('[data-product-id="p1"] [data-bind="product.stock"]')).toHaveText('2');
  await expect(page.locator('[data-product-id="p2"] [data-bind="product.stock"]')).toHaveText('9');

  const [response] = await Promise.all([
    page.waitForResponse(
      (candidate) =>
        candidate.url().endsWith('/_m/table-level-invalidation/restock') &&
        candidate.status() === 200,
    ),
    page.getByRole('button', { name: 'Restock low office stock' }).click(),
  ]);

  const body = await response.text();
  expect(body).toContain('<kovo-fragment target="product-p1">');
  expect(body).toContain('<output data-bind="product.stock">3</output>');
  expect(body).toContain('<kovo-fragment target="product-p2">');
  expect(body).toContain('<output data-bind="product.stock">10</output>');

  await expect(page.locator('[data-product-id="p1"] [data-bind="product.stock"]')).toHaveText('3');
  await expect(page.locator('[data-product-id="p2"] [data-bind="product.stock"]')).toHaveText('10');
  expect(await kovoApp.db.query('select id, stock from products order by id')).toEqual([
    { id: 'p1', stock: 3 },
    { id: 'p2', stock: 10 },
  ]);
  expect(kovoApp.verificationDiagnostics()).toEqual([]);
});
