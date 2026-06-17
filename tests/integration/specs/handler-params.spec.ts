import { fileURLToPath } from 'node:url';

import { expect, test } from '@kovojs/test/integration';

const fixturesRoot = fileURLToPath(new URL('../fixtures/', import.meta.url));

test.use({ fixturesRoot, kovoFixture: 'handler-params' });

test('passes element data-p params to the imported handler with coercion', async ({
  kovoApp,
  page,
}) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'Record params' }).click();

  await expect(page.locator('[data-result]')).toHaveText(
    JSON.stringify({
      enabled: true,
      itemId: 'sku-42',
      quantity: 3,
      quantityType: 'number',
    }),
  );
  expect(
    await kovoApp.semantic('main', { keepAttrs: ['on:click', 'data-p-item-id'] }),
  ).toMatchSnapshot('handler-params.semantic.txt');
});
