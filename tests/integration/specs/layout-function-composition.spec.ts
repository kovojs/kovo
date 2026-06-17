import { expect, test } from '@kovojs/test/internal/integration';

test.use({ kovoFixture: 'layout-function-composition' });

test('wraps routes with a layout function and reloads layout state per document', async ({
  page,
  kovoApp,
}) => {
  await page.goto('/');

  await expect(page.locator('main')).toHaveAttribute('data-layout-section', 'home');
  await expect(page.locator('[data-route="home"]')).toHaveText('Home document');
  await page.getByText('Layout drawer').click();
  await expect(page.locator('details')).toHaveJSProperty('open', true);

  const [documentResponse] = await Promise.all([
    page.waitForResponse((response) => {
      const url = new URL(response.url());
      return (
        url.pathname === '/reports' &&
        response.request().resourceType() === 'document' &&
        response.status() === 200
      );
    }),
    page.getByRole('link', { name: 'Reports' }).click(),
  ]);
  expect(documentResponse.headers()['content-type']).toContain('text/html');

  await expect(page.locator('main')).toHaveAttribute('data-layout-section', 'reports');
  await expect(page.locator('[data-route="reports"]')).toHaveText('Reports document');
  await expect(page.locator('details')).not.toHaveJSProperty('open', true);

  expect(await kovoApp.semantic('main', { keepAttrs: ['data-layout-section'] })).toMatchSnapshot(
    'layout-function-composition.semantic.txt',
  );
});
