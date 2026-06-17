import { fileURLToPath } from 'node:url';

import { expect, test } from '@kovojs/test/internal/integration';

const fixturesRoot = fileURLToPath(new URL('../fixtures/', import.meta.url));

test.use({ fixturesRoot, kovoFixture: 'on-visible' });

test('runs a declared on:visible trigger on first intersection', async ({ kovoApp, page }) => {
  await page.goto('/');

  await expect(page.locator('[data-status]')).toHaveText('waiting');
  await page.locator('[data-status]').scrollIntoViewIfNeeded();
  await expect(page.locator('[data-status]')).toHaveText('visible-ran');

  await page.evaluate(() => window.scrollTo(0, 0));
  await page.locator('[data-status]').scrollIntoViewIfNeeded();
  await expect(page.locator('[data-status]')).toHaveText('visible-ran');
  expect(await kovoApp.semantic('main', { keepAttrs: ['on:visible'] })).toMatchSnapshot(
    'on-visible.semantic.txt',
  );
});
