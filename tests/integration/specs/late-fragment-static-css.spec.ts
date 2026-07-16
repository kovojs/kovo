import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test } from '@kovojs/test/internal/integration';

test.use({ kovoFixture: 'late-fragment-static-css' });

const fixtureDir = fileURLToPath(new URL('../fixtures/late-fragment-static-css/', import.meta.url));
const fragmentCssAssetPath = join(fixtureDir, 'dist/assets/fragment.css');

test('enhanced mutation fragments deliver static late stylesheet links once', async ({
  page,
  kovoApp,
  request,
}) => {
  const assetCss = await readFile(fragmentCssAssetPath, 'utf8');
  expect(assetCss).toMatchSnapshot('late-fragment-static-css.css');

  // Assert wire bytes through the API client. Chromium may evict a completed enhanced-navigation
  // response body from CDP under a loaded shard even when `text()` starts immediately.
  const wireResponse = await request.post('/_m/late-fragment-static-css/reveal', {
    form: {},
    headers: {
      Accept: 'text/vnd.kovo.fragment+html; stream=1',
      'Kovo-Fragment': 'true',
      'Kovo-Stream': 'true',
    },
  });
  expect(wireResponse.status()).toBe(200);
  const body = await wireResponse.text();
  expect(body).toContain('<kovo-fragment target="recommendations" mode="append">');
  expect(body.match(/href="\/assets\/fragment\.css"/g)).toHaveLength(1);
  expect(body).toContain('<article class="recommendation-card" data-recommendation>');

  await page.goto('/');
  await expect(page.locator('link[href="/assets/fragment.css"]')).toHaveCount(0);

  await page.getByRole('button', { name: 'Show recommendation' }).click();

  const recommendation = page.locator('[data-recommendation]');
  await expect(recommendation).toHaveText('Styled recommendation');
  await expect(recommendation).toHaveCSS('background-color', 'rgb(12, 84, 96)');
  await expect(page.locator('link[href="/assets/fragment.css"]')).toHaveCount(1);

  expect(await kovoApp.semantic('[kovo-fragment-target="recommendations"]')).toMatchSnapshot(
    'late-fragment-static-css.semantic.txt',
  );
});
