import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { compile } from '@tailwindcss/node';
import { expect, test } from '@kovojs/test/integration';

test.use({ kovoFixture: 'tailwind-fragment-css' });

const fixtureDir = fileURLToPath(new URL('../fixtures/tailwind-fragment-css/', import.meta.url));
const fragmentCssSourcePath = join(fixtureDir, 'src/fragment.css');
const fragmentCssAssetPath = join(fixtureDir, 'dist/assets/fragment.css');

async function buildTailwindFragmentCss() {
  const source = await readFile(fragmentCssSourcePath, 'utf8');
  const result = await compile(source, {
    base: dirname(fragmentCssSourcePath),
    onDependency() {},
  });
  return result.build([]);
}

test('enhanced mutation fragments deliver Tailwind-generated late stylesheet links once', async ({
  page,
  kovoApp,
}) => {
  const [expectedCss, assetCss] = await Promise.all([
    buildTailwindFragmentCss(),
    readFile(fragmentCssAssetPath, 'utf8'),
  ]);
  expect(assetCss).toBe(expectedCss);
  expect(assetCss).toContain('.bg-\\[\\#0c5460\\]');
  expect(assetCss).toContain('.border-\\[\\#08424c\\]');

  await page.goto('/');
  await expect(page.locator('link[href="/assets/fragment.css"]')).toHaveCount(0);

  const [response] = await Promise.all([
    page.waitForResponse(
      (candidate) =>
        candidate.url().endsWith('/_m/tailwind-fragment-css/reveal') && candidate.status() === 200,
    ),
    page.getByRole('button', { name: 'Show recommendation' }).click(),
  ]);
  const body = await response.text();
  expect(body.match(/href="\/assets\/fragment\.css"/g)).toHaveLength(1);

  const recommendation = page.locator('[data-recommendation]');
  await expect(recommendation).toHaveText('Styled recommendation');
  await expect(recommendation).toHaveCSS('background-color', 'rgb(12, 84, 96)');
  await expect(page.locator('link[href="/assets/fragment.css"]')).toHaveCount(1);

  expect(await kovoApp.semantic('[kovo-fragment-target="recommendations"]')).toMatchSnapshot(
    'tailwind-fragment-css.semantic.txt',
  );
});
