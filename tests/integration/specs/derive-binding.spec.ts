import { expect, test } from '@kovojs/test/internal/integration';

test.use({ kovoFixture: 'derive-binding' });

test('updates compiler-authored query bindings when the query changes', async ({
  page,
  kovoApp,
}) => {
  await page.goto('/');

  const action = page.getByRole('button', { name: 'Ship order' });
  await expect(page.locator('[data-bind="inventory.count"]')).toHaveText('3');
  await expect(action).not.toBeDisabled();

  const [response] = await Promise.all([
    page.waitForResponse(
      (candidate) =>
        candidate.url().endsWith('/_m/derive-binding/sell-out') && candidate.status() === 200,
    ),
    page.getByRole('button', { name: 'Sell out' }).click(),
  ]);
  const body = await response.text();
  expect(body).toMatch(/<kovo-query name="inventory"[^>]*>/u);
  expect(body).toContain('<kovo-fragment target="inventory-panel">');

  await expect(page.locator('[data-bind="inventory.count"]')).toHaveText('0');
  await expect(page.locator('[data-bind="inventory.label"]')).toHaveText('Sold out');
  await expect(action).toBeDisabled();

  const rows = await kovoApp.db.query('select count, label from inventory_state where id = 1');
  expect(rows[0]).toEqual({ count: 0, label: 'Sold out' });
  expect(await kovoApp.semantic('inventory-panel')).toMatchSnapshot('derive-binding.semantic.txt');
});
