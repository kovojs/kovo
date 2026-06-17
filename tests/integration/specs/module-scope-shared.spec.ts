import { expect, test } from '@kovojs/test/internal/integration';

test.use({ kovoFixture: 'module-scope-shared' });

test('shares module-scope values across repeated handler imports while params stay per element', async ({
  kovoApp,
  page,
}) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'Record alpha' }).click();
  await expect(page.locator('[data-log]')).toHaveText(
    JSON.stringify({ callCount: 1, itemId: 'alpha', seen: ['alpha'] }),
  );

  await page.getByRole('button', { name: 'Record beta' }).click();
  await expect(page.locator('[data-log]')).toHaveText(
    JSON.stringify({ callCount: 2, itemId: 'beta', seen: ['alpha', 'beta'] }),
  );

  await page.getByRole('button', { name: 'Record alpha' }).click();
  await expect(page.locator('[data-log]')).toHaveText(
    JSON.stringify({ callCount: 3, itemId: 'alpha', seen: ['alpha', 'beta'] }),
  );

  expect(
    await kovoApp.semantic('main', { keepAttrs: ['on:click', 'data-p-item-id'] }),
  ).toMatchSnapshot('module-scope-shared.semantic.txt');
});
