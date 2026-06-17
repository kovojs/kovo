import { expect, test } from '@kovojs/test/integration';

import { expectAxeClean } from './a11y-axe';

test.use({ kovoFixture: 'primitive-state-attrs' });

test('primitive-owned state attrs win initially and update on interaction', async ({
  kovoApp,
  page,
}) => {
  await page.goto('/');

  const toggle = page.getByRole('button', { name: 'Alerts' });
  await expect(toggle).toHaveAttribute('data-state', 'off');
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');

  await toggle.click();
  await expect(toggle).toHaveAttribute('data-state', 'on');
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expectAxeClean(page);

  expect(
    await kovoApp.semantic('[data-case="primitive-state-attrs"]', {
      keepAttrs: ['aria-pressed', 'class', 'data-case', 'data-state', 'on:click', 'type'],
    }),
  ).toMatchSnapshot('primitive-state-attrs.semantic.txt');
});
