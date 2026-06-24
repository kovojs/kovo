import { expect, test } from '@kovojs/test/internal/integration';

import { expectAxeClean } from './a11y-axe';

test.use({ bypassCSP: true, kovoFixture: 'a11y-value-controls-terminal' });

test('native value controls expose terminal role name and value semantics', async ({
  page,
  kovoApp,
}) => {
  await page.goto('/');

  const volume = page.getByRole('slider', { name: 'Volume' });
  await expect(volume).toHaveValue('7');
  await volume.focus();
  await page.keyboard.press('ArrowRight');
  await expect(volume).toHaveValue('8');

  const quantity = page.getByRole('spinbutton', { name: 'Quantity' });
  await quantity.fill('6');
  await expect(quantity).toHaveValue('6');

  await expect(page.getByRole('group', { name: 'One-time code' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Digit 1' })).toHaveValue('4');
  await expect(page.getByRole('textbox', { name: 'Digit 2' })).toHaveValue('2');
  await expectAxeClean(page);

  expect(
    await kovoApp.semantic('main', {
      keepAttrs: ['for', 'id', 'inputmode', 'max', 'maxlength', 'min', 'pattern', 'value'],
    }),
  ).toMatchSnapshot('a11y-value-controls-terminal.semantic.txt');
});
