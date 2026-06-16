import { expect, test } from '@kovojs/test/integration';

test.use({ kovoFixture: 'dialog-invoker' });

test('declarative invoker opens a dialog without importing client code', async ({
  page,
  kovoApp,
}) => {
  const clientModuleRequests: string[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.startsWith('/c/')) {
      clientModuleRequests.push(request.url());
    }
  });

  await page.goto('/');
  await expect(page.locator('dialog')).not.toHaveJSProperty('open', true);

  await page.getByRole('button', { name: 'Open dialog' }).click();
  await expect(page.locator('dialog')).toHaveJSProperty('open', true);
  expect(clientModuleRequests).toEqual([]);

  expect(await kovoApp.semantic('main', { keepAttrs: ['command', 'commandfor', 'id'] }))
    .toMatchSnapshot('dialog.semantic.txt');
});
