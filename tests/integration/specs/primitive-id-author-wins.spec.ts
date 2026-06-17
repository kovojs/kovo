import { expect, test } from '@kovojs/test/internal/integration';

test.use({ kovoFixture: 'primitive-id-author-wins' });

test('primitive IDREFs are rewired when an author id wins', async ({ kovoApp, page }) => {
  await page.goto('/');

  const dialog = page.locator('[data-case="primitive-dialog"]');
  await expect(dialog).toHaveAttribute('id', 'authored-account-dialog');
  await expect(page.locator('[data-case="primitive-open-trigger"]')).toHaveAttribute(
    'commandfor',
    'authored-account-dialog',
  );
  await expect(page.locator('[data-case="primitive-open-trigger"]')).toHaveAttribute(
    'aria-controls',
    'authored-account-dialog',
  );

  await page.getByRole('button', { name: 'Open account dialog' }).click();
  await expect(dialog).toHaveJSProperty('open', true);

  expect(
    await kovoApp.semantic('[data-case="primitive-id-author-wins"]', {
      keepAttrs: [
        'aria-controls',
        'aria-haspopup',
        'aria-labelledby',
        'class',
        'command',
        'commandfor',
        'data-case',
        'data-state',
        'id',
        'type',
      ],
    }),
  ).toMatchSnapshot('primitive-id-author-wins.semantic.txt');
});
