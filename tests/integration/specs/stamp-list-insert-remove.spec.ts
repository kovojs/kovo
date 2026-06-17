import { expect, test } from '@kovojs/test/integration';

test.use({ kovoFixture: 'stamp-list-insert-remove' });

test('keyed template stamps insert, remove, and bind item-relative paths through fragment patches', async ({
  page,
  kovoApp,
}) => {
  await page.goto('/');

  const rows = page.locator('[data-bind-list="cart.items"] > li[kovo-key]');
  await expect(rows).toHaveText(['2 Adapter', '4 Battery']);

  const [insertResponse] = await Promise.all([
    page.waitForResponse((candidate) =>
      candidate.url().endsWith('/_m/stamp-list-insert-remove/change'),
    ),
    page.getByRole('button', { name: 'Insert item' }).click(),
  ]);
  expect(insertResponse.status()).toBe(200);
  const insertBody = await insertResponse.text();
  expect(insertBody).toContain('<kovo-fragment target="cart-list">');
  await expect(rows).toHaveText(['2 Adapter', '4 Battery', '1 Cable']);

  await Promise.all([
    page
      .waitForResponse((candidate) =>
        candidate.url().endsWith('/_m/stamp-list-insert-remove/change'),
      )
      .then((response) => expect(response.status()).toBe(200)),
    page.getByRole('button', { name: 'Remove item' }).click(),
  ]);
  await expect(rows).toHaveText(['2 Adapter', '1 Cable']);
  await expect(page.locator('[data-bind-list="cart.items"] > li[kovo-key="b"]')).toHaveCount(0);

  const keys = await rows.evaluateAll((elements) =>
    elements.map((element) => element.getAttribute('kovo-key')),
  );
  expect(keys).toEqual(['a', 'c']);

  const rowsInDb = await kovoApp.db.query('select id, name, qty from cart_item order by position');
  expect(rowsInDb).toEqual([
    { id: 'a', name: 'Adapter', qty: 2 },
    { id: 'c', name: 'Cable', qty: 1 },
  ]);
  expect(await kovoApp.semantic('cart-list')).toMatchSnapshot(
    'stamp-list-insert-remove.semantic.txt',
  );
});
