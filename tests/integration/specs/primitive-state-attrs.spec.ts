import { expect, test } from '@kovojs/test/internal/integration';

import { expectAxeClean } from './a11y-axe';

test.use({ kovoFixture: 'primitive-state-attrs' });

test('primitive-owned authored attrs win over consumer attrs', async ({ kovoApp, page }) => {
  await page.goto('/');

  const toggle = page.getByRole('button', { name: 'Alerts' });
  await expect(toggle).toHaveAttribute('data-state', 'off');
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');

  await expectAxeClean(page);

  expect(
    await kovoApp.semantic('[data-case="primitive-state-attrs"]', {
      keepAttrs: ['aria-pressed', 'class', 'data-case', 'data-state', 'on:click', 'type'],
    }),
  ).toMatchSnapshot('primitive-state-attrs.semantic.txt');
});
