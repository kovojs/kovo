import { fileURLToPath } from 'node:url';

import { expect, test } from '@kovojs/test/integration';

const fixturesRoot = fileURLToPath(new URL('../fixtures/', import.meta.url));

test.use({ fixturesRoot, kovoFixture: 'on-idle' });

test('runs a declared on:idle trigger once idle work is scheduled', async ({ kovoApp, page }) => {
  await page.goto('/');

  await expect(page.locator('[data-status]')).toHaveText('idle-ran');
  expect(await kovoApp.semantic('main', { keepAttrs: ['on:idle'] })).toMatchSnapshot(
    'on-idle.semantic.txt',
  );
});
