import { expect, test } from '@kovojs/test/integration';

test.use({ kovoFixture: 'multi-instance-query' });

test('keeps parameterized query instances distinct on the wire and applies only the matching keyed query chunk', async ({
  page,
  kovoApp,
}) => {
  await page.goto('/');

  await expect(page.locator('script[kovo-query="product"][key="product:p1"]')).toHaveCount(1);
  await expect(page.locator('script[kovo-query="product"][key="product:p2"]')).toHaveCount(1);
  await expect(page.locator('[data-product-id="p1"] [data-bind="product.stock"]')).toHaveText('2');
  await expect(page.locator('[data-product-id="p2"] [data-bind="product.stock"]')).toHaveText('9');

  await page.locator('[data-product-id="p2"]').evaluate((element) => {
    (element as HTMLElement & { __identity?: string }).__identity = 'p2-card';
  });

  const [response] = await Promise.all([
    page.waitForResponse((candidate) =>
      candidate.url().endsWith('/_m/multi-instance-query/restock') &&
      candidate.status() === 200,
    ),
    page.getByRole('button', { name: 'Restock Pen' }).click(),
  ]);
  const body = await response.text();
  expect(body).toContain('<kovo-query name="product" key="product:p1">');
  expect(body).not.toContain('key="product:p2"');
  expect(body).not.toContain('<kovo-fragment target="product-p1">');
  expect(body).not.toContain('<kovo-fragment target="product-p2">');

  await expect(page.locator('[data-product-id="p1"] [data-bind="product.stock"]')).toHaveText('7');
  await expect(page.locator('[data-product-id="p2"] [data-bind="product.stock"]')).toHaveText('9');
  await expect
    .poll(() =>
      page.locator('[data-product-id="p2"]').evaluate((element) => {
        return (element as HTMLElement & { __identity?: string }).__identity;
      }),
    )
    .toBe('p2-card');

  const rows = await kovoApp.db.query('select id, stock from product order by id');
  expect(rows).toEqual([
    { id: 'p1', stock: 7 },
    { id: 'p2', stock: 9 },
  ]);
  expect(await kovoApp.semantic('main')).toMatchSnapshot('multi-instance-query.semantic.txt');
});
