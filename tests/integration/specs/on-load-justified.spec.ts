import { fileURLToPath } from 'node:url';

import { expect, test } from '@kovojs/test/internal/integration';

const fixturesRoot = fileURLToPath(new URL('../fixtures/', import.meta.url));

test.use({ fixturesRoot, kovoFixture: 'on-load-justified' });

test('runs a declared on:load trigger at parse time', async ({ kovoApp, page }) => {
  await page.goto('/');

  await expect(page.locator('[data-status]')).toHaveText('loaded');
  expect(await kovoApp.semantic('main', { keepAttrs: ['on:load'] })).toMatchSnapshot(
    'on-load-justified.semantic.txt',
  );
});
