import { expect, test } from '@kovojs/test/internal/integration';

test.use({ kovoFixture: 'details-disclosure' });

test('native details toggles open without importing client code', async ({ page, kovoApp }) => {
  const clientModuleRequests: string[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.startsWith('/c/')) {
      clientModuleRequests.push(request.url());
    }
  });

  await page.goto('/');
  await expect(page.locator('details')).not.toHaveJSProperty('open', true);

  await page.getByText('Shipping details').click();
  await expect(page.locator('details')).toHaveJSProperty('open', true);
  expect(clientModuleRequests).toEqual([]);

  expect(await kovoApp.semantic('main', { keepAttrs: ['open'] })).toMatchSnapshot(
    'details.semantic.txt',
  );
});
