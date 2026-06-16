import { expect, test } from '@kovojs/test/integration';

test.use({ kovoFixture: 'scoped-component-css' });

test('co-located component CSS is scoped to the host and deduped in page hints', async ({
  page,
  request,
  kovoApp,
}) => {
  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'Scoped panel' })).toHaveCSS(
    'color',
    'rgb(12, 84, 96)',
  );
  await expect(page.locator('[data-nested-copy]')).toHaveCSS('color', 'rgb(0, 0, 0)');
  await expect(page.locator('link[rel="stylesheet"][href="/assets/scoped-panel.css"]')).toHaveCount(
    1,
  );

  const asset = await request.get('/assets/scoped-panel.css');
  expect(asset.status()).toBe(200);
  expect(await asset.text()).toContain('@scope ([kovo-c="scoped-panel"]) to (:scope [kovo-c])');

  expect(await kovoApp.semantic('main')).toMatchSnapshot('scoped-component-css.semantic.txt');
});
