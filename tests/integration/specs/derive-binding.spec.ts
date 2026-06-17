import { expect, test } from '@kovojs/test/internal/integration';

test.use({ kovoFixture: 'derive-binding' });

test('lazily imports a named derive on query change and updates the bound attribute', async ({
  page,
  kovoApp,
}) => {
  await page.goto('/');

  const action = page.getByRole('button', { name: 'Ship order' });
  await expect(page.locator('[data-bind="inventory.count"]')).toHaveText('3');
  await expect(action).not.toBeDisabled();
  await expect.poll(() => page.evaluate(() => window.__deriveBindingImports ?? 0)).toBe(0);

  const [response] = await Promise.all([
    page.waitForResponse(
      (candidate) =>
        candidate.url().endsWith('/_m/derive-binding/sell-out') && candidate.status() === 200,
    ),
    page.getByRole('button', { name: 'Sell out' }).click(),
  ]);
  const body = await response.text();
  expect(body).toContain('<kovo-query name="inventory">');
  expect(body).not.toContain('<kovo-fragment');

  await expect(page.locator('[data-bind="inventory.count"]')).toHaveText('0');
  await expect(page.locator('[data-bind="inventory.label"]')).toHaveText('Sold out');
  await expect(action).toBeDisabled();
  await expect.poll(() => page.evaluate(() => window.__deriveBindingImports ?? 0)).toBe(1);

  const rows = await kovoApp.db.query('select count, label from inventory_state where id = 1');
  expect(rows[0]).toEqual({ count: 0, label: 'Sold out' });
  expect(
    await kovoApp.semantic('inventory-panel', { keepAttrs: ['data-bind:disabled'] }),
  ).toMatchSnapshot('derive-binding.semantic.txt');
});
