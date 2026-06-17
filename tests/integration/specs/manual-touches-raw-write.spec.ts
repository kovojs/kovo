import { expect, test } from '@kovojs/test/integration';

test.use({ kovoFixture: 'manual-touches-raw-write' });

test('runtime-verifies raw writes covered by manual touches and refreshes dependent query state', async ({
  page,
  kovoApp,
}) => {
  await page.goto('/');
  await expect(page.getByTestId('cart-count')).toHaveText('0');

  const [response] = await Promise.all([
    page.waitForResponse(
      (candidate) =>
        candidate.url().endsWith('/_m/manual-touches-raw-write/add') && candidate.status() === 200,
    ),
    page.getByRole('button', { name: 'Add opaque item' }).click(),
  ]);

  const body = await response.text();
  expect(body).toContain('<kovo-query name="cart">{"count":1}</kovo-query>');
  expect(body).toContain('data-testid="cart-count">1</output>');

  await expect(page.getByTestId('cart-count')).toHaveText('1');
  expect(await kovoApp.db.query('select product_id from cart_items')).toEqual([
    { product_id: 'p1' },
  ]);
  expect(kovoApp.verificationDiagnostics()).toEqual([]);
});
