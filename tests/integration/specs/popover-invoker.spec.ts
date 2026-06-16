import { expect, test } from '@kovojs/test/integration';

test.use({ kovoFixture: 'popover-invoker' });

test('native popover invoker toggles light DOM without importing client code', async ({
  kovoApp,
  page,
}) => {
  const clientModuleRequests: string[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.startsWith('/c/')) {
      clientModuleRequests.push(request.url());
    }
  });

  await page.goto('/');
  const popover = page.locator('#account-popover');
  await expect
    .poll(() =>
      popover.evaluate((element) =>
        'matches' in element ? element.matches(':popover-open') : false,
      ),
    )
    .toBe(false);

  await page.getByRole('button', { name: 'Toggle account menu' }).click();
  await expect
    .poll(() => popover.evaluate((element) => element.matches(':popover-open')))
    .toBe(true);
  expect(clientModuleRequests).toEqual([]);

  expect(
    await kovoApp.semantic('main', {
      keepAttrs: ['id', 'popover', 'popovertarget', 'popovertargetaction'],
    }),
  ).toMatchSnapshot('popover.semantic.txt');
});
