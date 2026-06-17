// I3: typed mutation error union. A successful buy morphs the stock badge; a buy
// against empty stock morphs a typed error fragment (data-error-code), no nav.
import { expect, test } from '@kovojs/test/internal/integration';

test.use({ kovoFixture: 'stock' });

const STOCK = '[data-bind="item.stock"]';
const ERROR = '[data-error-code="OUT_OF_STOCK"]';

async function clickBuy(page: import('@kovojs/test/internal/integration').Page): Promise<void> {
  await Promise.all([
    page.waitForResponse((response) => response.url().endsWith('/_m/stock/buy')),
    page.getByRole('button', { name: 'Buy' }).click(),
  ]);
}

test('successful buy decrements; empty stock surfaces a typed error', async ({ page, kovoApp }) => {
  await page.goto('/');
  await expect(page.locator(STOCK)).toHaveText('1');
  await expect(page.locator('[data-error-code]')).toHaveCount(0);

  // First buy succeeds: stock badge morphs 1 -> 0, no error.
  await clickBuy(page);
  await expect(page.locator(STOCK)).toHaveText('0');
  await expect(page.locator('[data-error-code]')).toHaveCount(0);

  // Second buy fails with the typed OUT_OF_STOCK error: error fragment morphs in.
  await clickBuy(page);
  await expect(page.locator(ERROR)).toBeVisible();
  expect(new URL(page.url()).pathname).toBe('/');

  // Server truth: stock never went negative.
  const rows = await kovoApp.db.query('select stock from item where id = 1');
  expect(rows[0]).toEqual({ stock: 0 });

  expect(await kovoApp.semantic('[kovo-fragment-target="buy-error"]')).toMatchSnapshot(
    'buy-error.semantic.txt',
  );
});
