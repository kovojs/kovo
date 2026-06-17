import { expect, test } from '@kovojs/test/internal/integration';

test.use({ kovoFixture: 'native-host-kovo-c' });

test('stamps component identity on a native table host', async ({ page, kovoApp }) => {
  const response = await page.goto('/');
  expect(response?.ok()).toBeTruthy();

  await expect(page.locator('line-items-table')).toHaveCount(0);
  await expect(page.locator('table[kovo-c="line-items-table"]')).toHaveCount(1);
  await expect(page.locator('tbody > tr')).toHaveCount(2);
  await expect(page.locator('tbody > tr').first()).toHaveAttribute('data-row', 'sku-notebook');
  await expect(page.locator('tbody > tr').nth(1)).toHaveAttribute('data-row', 'sku-pencil');
  await expect(page.getByRole('row', { name: 'Notebook 2' })).toBeVisible();
  await expect(page.getByRole('row', { name: 'Pencil 6' })).toBeVisible();

  expect(await kovoApp.semantic('table')).toMatchSnapshot('native-host-kovo-c.semantic.txt');
});
