import { expect, test } from '@kovojs/test/integration';

test.use({ kovoFixture: 'morph-focus-caret' });

test('preserves focus and caret while reconciling server text', async ({ page, kovoApp }) => {
  await page.goto('/');

  const input = page.getByLabel('Draft');
  await input.fill('client edited draft');
  await input.evaluate((element) => {
    const inputElement = element as HTMLInputElement;
    inputElement.setSelectionRange(7, 13, 'forward');
  });
  await expect(input).toBeFocused();
  await expect(page.locator('[data-bind="profile.version"]')).toHaveText('0');

  await Promise.all([
    page.waitForResponse(
      (response) =>
        response.url().endsWith('/_m/profile/save-draft') && response.status() === 200,
    ),
    input.press('Enter'),
  ]);

  await expect(input).toBeFocused();
  await expect(page.locator('[data-bind="profile.version"]')).toHaveText('1');
  await expect(input).toHaveValue('client edited draft');
  await expect
    .poll(() =>
      input.evaluate((element) => ({
        direction: (element as HTMLInputElement).selectionDirection,
        end: (element as HTMLInputElement).selectionEnd,
        start: (element as HTMLInputElement).selectionStart,
      })),
    )
    .toEqual({ direction: 'forward', end: 13, start: 7 });

  const rows = await kovoApp.db.query('select version from profile where id = 1');
  expect(rows[0]).toEqual({ version: 1 });
  expect(await kovoApp.semantic('[kovo-fragment-target="profile-editor"]')).toMatchSnapshot(
    'profile-editor.semantic.txt',
  );
});
