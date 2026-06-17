import { expect, test } from '@kovojs/test/integration';

test.use({ kovoFixture: 'stamp-list-reorder' });

test('keyed template stamps reorder without replacing existing row identity', async ({
  page,
  kovoApp,
}) => {
  await page.goto('/');

  const rows = page.locator('[data-bind-list="board.items"] > li[kovo-key]');
  await expect(rows).toHaveText(['1 Alpha', '2 Beta', '3 Gamma']);
  await page.locator('[kovo-key="a"]').evaluate((element) => {
    (element as HTMLElement & { __identity?: string }).__identity = 'row-a';
  });
  await page.locator('[kovo-key="b"]').evaluate((element) => {
    (element as HTMLElement & { __identity?: string }).__identity = 'row-b';
  });

  const [response] = await Promise.all([
    page.waitForResponse(
      (candidate) =>
        candidate.url().endsWith('/_m/stamp-list-reorder/reorder') && candidate.status() === 200,
    ),
    page.getByRole('button', { name: 'Reorder board' }).click(),
  ]);
  const body = await response.text();
  expect(body).toContain('<kovo-query name="board">');
  expect(body).not.toContain('<kovo-fragment');

  await expect(rows).toHaveText(['1 Beta', '2 Gamma', '3 Alpha moved']);
  await expect(page.locator('[data-bind-list="board.items"] > li').nth(2)).toHaveAttribute(
    'kovo-key',
    'a',
  );
  await expect
    .poll(() =>
      page.locator('[kovo-key="a"]').evaluate((element) => {
        return (element as HTMLElement & { __identity?: string }).__identity;
      }),
    )
    .toBe('row-a');
  await expect
    .poll(() =>
      page.locator('[kovo-key="b"]').evaluate((element) => {
        return (element as HTMLElement & { __identity?: string }).__identity;
      }),
    )
    .toBe('row-b');

  const order = await rows.evaluateAll((elements) =>
    elements.map((element) => element.getAttribute('kovo-key')),
  );
  expect(order).toEqual(['b', 'c', 'a']);

  const dbRows = await kovoApp.db.query('select id, label, rank from board_item order by rank');
  expect(dbRows).toEqual([
    { id: 'b', label: 'Beta', rank: 1 },
    { id: 'c', label: 'Gamma', rank: 2 },
    { id: 'a', label: 'Alpha moved', rank: 3 },
  ]);
  expect(await kovoApp.semantic('board-list')).toMatchSnapshot('stamp-list-reorder.semantic.txt');
});
