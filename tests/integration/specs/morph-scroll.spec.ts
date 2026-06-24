import { expect, test } from '@kovojs/test/internal/integration';

test.use({ kovoFixture: 'morph-scroll' });

test('preserves keyed scroll position while reconciling inserted content', async ({
  kovoApp,
  page,
}) => {
  await page.goto('/');

  const scroller = page.locator('[data-scroll-region]');
  await expect
    .poll(() => scroller.evaluate((element) => element.scrollHeight > element.clientHeight))
    .toBe(true);
  await scroller.evaluate((element) => {
    element.scrollTop = 180;
  });
  const beforeScrollTop = await scroller.evaluate((element) => element.scrollTop);
  expect(beforeScrollTop).toBeGreaterThan(0);
  await expect(page.locator('[data-bind="scroll.version"]')).toHaveText('0');

  await Promise.all([
    page.waitForResponse(
      (response) => response.url().endsWith('/_m/scroll/refresh') && response.status() === 200,
    ),
    page.getByRole('button', { name: 'Refresh content' }).click(),
  ]);

  await expect(page.locator('[data-bind="scroll.version"]')).toHaveText('1');
  await expect(page.locator('[data-row="14"]')).toHaveText('Inserted content version 1');
  await expect.poll(() => scroller.evaluate((element) => element.scrollTop)).toBe(beforeScrollTop);

  const rows = await kovoApp.db.query('select version from scroll_state where id = 1');
  expect(rows[0]).toEqual({ version: 1 });
  expect(await kovoApp.semantic('[kovo-fragment-target="scroll-panel"]')).toMatchSnapshot(
    'scroll-panel.semantic.txt',
  );
});
