import { expect, test } from '@kovojs/test/internal/integration';

import { expectAxeClean } from './a11y-axe';

test.use({ kovoFixture: 'a11y-dialog-terminal' });

test('dialog terminal open state keeps role name and focus semantics', async ({
  page,
  kovoApp,
}) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'Open settings' }).click();

  const dialog = page.getByRole('dialog', { name: 'Account settings' });
  await expect(dialog).toBeVisible();
  await expect(page.locator('dialog')).toHaveJSProperty('open', true);
  await expect(page.getByRole('button', { name: 'Close settings' })).toBeFocused();
  await expectAxeClean(page);

  expect(
    await kovoApp.semantic('main', { keepAttrs: ['command', 'commandfor', 'id', 'open'] }),
  ).toMatchSnapshot('a11y-dialog-terminal.semantic.txt');
});
