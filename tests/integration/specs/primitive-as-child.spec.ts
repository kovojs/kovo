import { expect, test } from '@kovojs/test/integration';

test.use({ kovoFixture: 'primitive-as-child' });

test('asChild lowers primitive attrs onto one author-owned element', async ({ kovoApp, page }) => {
  await page.goto('/');

  await expect(page.locator('main > section[data-case="primitive-as-child"]')).toHaveCount(1);
  await expect(page.locator('[data-case="primitive-as-child-trigger"]')).toHaveCount(1);

  expect(
    await kovoApp.semantic('[data-case="primitive-as-child"]', {
      keepAttrs: ['aria-controls', 'aria-label', 'class', 'data-state', 'id', 'on:click', 'role'],
    }),
  ).toMatchSnapshot('primitive-as-child.semantic.txt');
});
