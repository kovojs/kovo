import { fileURLToPath } from 'node:url';

import { expect, test } from '@kovojs/test/integration';

const fixturesRoot = fileURLToPath(new URL('../fixtures/', import.meta.url));

test.use({ fixturesRoot, kovoFixture: 'event-chain' });

test('runs chained event refs in order even when default is prevented', async ({
  kovoApp,
  page,
}) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'Run chain' }).click();

  await expect(page.locator('[data-order]')).toHaveText('author:prevented,primitive:saw-prevented');
  expect(await kovoApp.semantic('main', { keepAttrs: ['on:click'] })).toMatchSnapshot(
    'event-chain.semantic.txt',
  );
});
