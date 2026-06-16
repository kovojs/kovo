import { expect, test } from '@kovojs/test/integration';

test.use({ kovoFixture: 'children-render-time' });

test('renders children and named slots in the initial server HTML', async ({ page, kovoApp }) => {
  const clientModuleRequests: string[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.startsWith('/c/')) clientModuleRequests.push(request.url());
  });

  const response = await page.goto('/');
  expect(response?.ok()).toBeTruthy();

  await expect(page.getByRole('heading', { level: 1, name: 'Server composition' })).toBeVisible();
  await expect(page.locator('[data-slot="body"]')).toHaveText(
    'Children rendered on the server',
  );
  await expect(page.locator('[data-slot="footer"]')).toHaveText(
    'Named slot rendered on the server',
  );
  expect(clientModuleRequests).toEqual([]);

  expect(await kovoApp.semantic('main', { keepAttrs: ['data-slot'] })).toMatchSnapshot(
    'children-render-time.semantic.txt',
  );
});
