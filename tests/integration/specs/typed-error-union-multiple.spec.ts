// SPEC.md §6.3/§9.2: enhanced typed errors are an exhaustive declared union.
import { expect, test } from '@kovojs/test/internal/integration';

test.use({ kovoFixture: 'typed-error-union-multiple' });

async function submitQuantity(
  page: import('@kovojs/test/internal/integration').Page,
  quantity: string,
) {
  await page.getByRole('spinbutton', { name: 'Quantity' }).fill(quantity);
  const responsePromise = page.waitForResponse(
    (response) => response.url().endsWith('/_m/checkout/submit') && response.status() === 422,
  );
  await page.getByRole('button', { name: 'Pay' }).click();
  return responsePromise;
}

test('each declared error code renders the matching enhanced branch', async ({ page, kovoApp }) => {
  await page.goto('/');

  const stockResponse = await submitQuantity(page, '4');
  await expect(page.locator('[data-error-code="OUT_OF_STOCK"]')).toHaveText('Only 3 available');
  expect(await stockResponse.text()).not.toContain('Error:');

  expect(await kovoApp.semantic('[kovo-fragment-target="checkout-error"]')).toMatchSnapshot(
    'out-of-stock.semantic.txt',
  );

  const cardResponse = await submitQuantity(page, '2');
  await expect(page.locator('[data-error-code="CARD_DECLINED"]')).toHaveText('Card declined');
  expect(await cardResponse.text()).not.toContain('Error:');

  const rows = await kovoApp.db.query('select stock from inventory where id = 1');
  expect(rows[0]).toEqual({ stock: 3 });

  expect(await kovoApp.semantic('[kovo-fragment-target="checkout-error"]')).toMatchSnapshot(
    'card-declined.semantic.txt',
  );
});
