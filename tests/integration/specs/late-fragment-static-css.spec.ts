import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test } from '@kovojs/test/integration';

test.use({ kovoFixture: 'late-fragment-static-css' });

const fixtureDir = fileURLToPath(new URL('../fixtures/late-fragment-static-css/', import.meta.url));
const fragmentCssAssetPath = join(fixtureDir, 'dist/assets/fragment.css');

test('enhanced mutation fragments deliver static late stylesheet links once', async ({
  page,
  kovoApp,
}) => {
  const assetCss = await readFile(fragmentCssAssetPath, 'utf8');
  expect(assetCss).toMatchSnapshot('late-fragment-static-css.css');

  await page.goto('/');
  await expect(page.locator('link[href="/assets/fragment.css"]')).toHaveCount(0);

  const [response] = await Promise.all([
    page.waitForResponse(
      (candidate) =>
        candidate.url().endsWith('/_m/late-fragment-static-css/reveal') &&
        candidate.status() === 200,
    ),
    page.getByRole('button', { name: 'Show recommendation' }).click(),
  ]);
  const body = await response.text();
  expect(body).toMatchSnapshot('late-fragment-static-css.response.html');

  const recommendation = page.locator('[data-recommendation]');
  await expect(recommendation).toHaveText('Styled recommendation');
  await expect(recommendation).toHaveCSS('background-color', 'rgb(12, 84, 96)');
  await expect(page.locator('link[href="/assets/fragment.css"]')).toHaveCount(1);

  expect(await kovoApp.semantic('[kovo-fragment-target="recommendations"]')).toMatchSnapshot(
    'late-fragment-static-css.semantic.txt',
  );
});
