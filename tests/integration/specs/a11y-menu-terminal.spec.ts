import { expect, test } from '@kovojs/test/integration';

import { expectAxeClean } from './a11y-axe';

test.use({ kovoFixture: 'a11y-menu-terminal' });

test('menu terminal open state exposes expanded trigger and active item semantics', async ({
  page,
  kovoApp,
}) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'Account actions' }).click();

  await expect(page.getByRole('button', { name: 'Account actions' })).toHaveAttribute(
    'aria-expanded',
    'true',
  );
  await expect(page.getByRole('menu', { name: 'Account actions' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'View profile' })).toBeFocused();
  await expect(page.getByRole('menuitem', { name: 'View profile' })).toHaveAttribute(
    'data-state',
    'active',
  );
  await expectAxeClean(page);

  expect(
    await kovoApp.semantic('main', {
      keepAttrs: [
        'aria-controls',
        'aria-expanded',
        'aria-haspopup',
        'aria-labelledby',
        'hidden',
        'id',
      ],
    }),
  ).toMatchSnapshot('a11y-menu-terminal.semantic.txt');
});
