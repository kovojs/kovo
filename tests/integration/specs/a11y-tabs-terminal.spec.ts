import { expect, test } from '@kovojs/test/integration';

import { expectAxeClean } from './a11y-axe';

test.use({ kovoFixture: 'a11y-tabs-terminal' });

test('tabs terminal selected state exposes role and panel relationships', async ({
  page,
  kovoApp,
}) => {
  await page.goto('/');

  await page.getByRole('tab', { name: 'Billing' }).click();

  const billingTab = page.getByRole('tab', { name: 'Billing', selected: true });
  await expect(billingTab).toBeFocused();
  await expect(billingTab).toHaveAttribute('data-state', 'active');
  await expect(page.getByRole('tabpanel', { name: 'Billing' })).toHaveText('Billing history');
  await expect(page.getByRole('tab', { name: 'Profile' })).toHaveAttribute(
    'aria-selected',
    'false',
  );
  await expectAxeClean(page);

  expect(
    await kovoApp.semantic('[aria-label="Account sections"]', {
      keepAttrs: ['aria-controls', 'aria-labelledby', 'aria-selected', 'data-state', 'hidden', 'id'],
    }),
  ).toMatchSnapshot('a11y-tabs-terminal.semantic.txt');
});
