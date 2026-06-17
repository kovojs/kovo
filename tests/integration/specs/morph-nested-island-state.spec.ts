import { expect, test } from '@kovojs/test/integration';

test.use({ kovoFixture: 'morph-nested-island-state' });

test('preserves nested island local state while parent fragment morphs', async ({
  page,
  kovoApp,
}) => {
  await page.goto('/');
  await page.waitForFunction(
    () =>
      (window as typeof window & { __morphNestedIslandReady?: boolean })
        .__morphNestedIslandReady === true,
  );

  const parentVersion = page.locator('[data-bind="parent.version"]');
  const nested = page.locator('nested-counter');
  const nestedButton = nested.getByRole('button');
  const nestedCount = nested.locator('[data-bind="state.count"]');
  await expect(parentVersion).toHaveText('0');
  await expect(nestedCount).toHaveText('0');

  await nestedButton.click();
  await expect(nestedCount).toHaveText('1');
  await expect(nested).toHaveAttribute('kovo-state', '{"count":1}');
  await page.evaluate(() => {
    (window as typeof window & { __nestedIslandBefore?: Element | null }).__nestedIslandBefore =
      document.querySelector('nested-counter');
  });

  await Promise.all([
    page.waitForResponse(
      (response) =>
        response.url().endsWith('/_m/morph-nested-island-state/refresh') &&
        response.status() === 200,
    ),
    page.getByRole('button', { name: 'Refresh parent' }).click(),
  ]);

  await expect(parentVersion).toHaveText('1');
  await expect(nestedCount).toHaveText('1');
  await expect(nested).toHaveAttribute('kovo-state', '{"count":1}');
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          document.querySelector('nested-counter') ===
          (window as typeof window & { __nestedIslandBefore?: Element | null })
            .__nestedIslandBefore,
      ),
    )
    .toBe(true);

  const rows = await kovoApp.db.query('select version from nested_island_parent where id = 1');
  expect(rows[0]).toEqual({ version: 1 });
  expect(await kovoApp.semantic('[kovo-fragment-target="parent-panel"]')).toMatchSnapshot(
    'morph-nested-island-state.semantic.txt',
  );
});
