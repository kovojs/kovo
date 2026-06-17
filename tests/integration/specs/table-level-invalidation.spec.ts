import { expect, test } from '@kovojs/test/integration';

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
  expect(body).toContain(
    '<kovo-query name="product" key="product:p1">{"id":"p1","label":"Pen","stock":3}</kovo-query>',
  );
  expect(body).toContain(
    '<kovo-query name="product" key="product:p2">{"id":"p2","label":"Notebook","stock":10}</kovo-query>',
  );

  await expect(page.locator('[data-product-id="p1"] [data-bind="product.stock"]')).toHaveText('3');
  await expect(page.locator('[data-product-id="p2"] [data-bind="product.stock"]')).toHaveText('10');
  expect(await kovoApp.db.query('select id, stock from products order by id')).toEqual([
    { id: 'p1', stock: 3 },
    { id: 'p2', stock: 10 },
  ]);
  expect(kovoApp.verificationDiagnostics()).toEqual([]);
});
