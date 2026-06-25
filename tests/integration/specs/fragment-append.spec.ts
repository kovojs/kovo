import { expect, test } from '@kovojs/test/internal/integration';

test.use({ kovoFixture: 'fragment-append' });

test('append fragments add rows without replacing existing keyed content', async ({
  page,
  kovoApp,
}) => {
  await page.goto('/');
  await expect(page.locator('[kovo-fragment-target="feed"] article')).toHaveCount(2);
  const firstRow = await page.locator('[data-row="1"]').elementHandle();
  expect(firstRow).not.toBeNull();

  await Promise.all([
    page.waitForResponse(
      (response) => response.url().endsWith('/_m/feed/load-more') && response.status() === 200,
    ),
    page.getByRole('button', { name: 'Load more' }).click(),
  ]);

  await expect(page.locator('[kovo-fragment-target="feed"] article')).toHaveCount(3);
  await expect(page.locator('[data-row="1"]')).toHaveText('Item 1');
  await expect(page.locator('[data-row="2"]')).toHaveText('Item 2');
  await expect(page.locator('[data-row="3"]')).toHaveText('Item 3');
  expect(await firstRow!.evaluate((element) => element.isConnected)).toBe(true);

  const rows = await kovoApp.db.query('select id, title from feed order by id');
  expect(rows).toEqual([
    { id: 1, title: 'Item 1' },
    { id: 2, title: 'Item 2' },
    { id: 3, title: 'Item 3' },
  ]);
});
