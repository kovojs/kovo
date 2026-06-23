import { expect, test } from '@kovojs/test/internal/integration';

import { isAuthoredClientModuleRequest } from './client-module-requests';

test.use({ kovoFixture: 'patched-in-island-inert' });

test('patched-in islands stay inert until their first delegated interaction', async ({
  kovoApp,
  page,
}) => {
  const clientModuleRequests: string[] = [];
  page.on('request', (request) => {
    if (isAuthoredClientModuleRequest(request.url())) clientModuleRequests.push(request.url());
  });

  await page.goto('/');
  await expect(page.locator('[data-empty-zone]')).toHaveText('No island yet');

  await Promise.all([
    page.waitForResponse(
      (response) => response.url().endsWith('/_m/island/add') && response.status() === 200,
    ),
    page.getByRole('button', { name: 'Patch island' }).click(),
  ]);

  await expect(page.getByRole('button', { name: 'Activate patched island' })).toBeVisible();
  await expect(page.locator('[data-island-output]')).toHaveText('0');
  expect(clientModuleRequests).toEqual([]);
  expect(
    await kovoApp.semantic('[kovo-fragment-target="patch-zone"]', {
      keepAttrs: ['data-p-label', 'on:click'],
    }),
  ).toMatchSnapshot('patch-zone.semantic.txt');

  await page.getByRole('button', { name: 'Activate patched island' }).click();

  await expect(page.locator('[data-island-output]')).toHaveText('1');
  await expect(page.locator('[data-island-output]')).toHaveAttribute('data-label', 'patched');
  expect(clientModuleRequests).toHaveLength(1);

  const rows = await kovoApp.db.query('select installed from island_patch where id = 1');
  expect(rows[0]).toEqual({ installed: 1 });
});
