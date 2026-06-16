// I3: the core interactive round trip. Click an enhanced form → the mutation runs
// server-side against PGlite → the bound component morphs in place (no navigation).
import { expect, test } from '@kovojs/test/integration';

test.use({ kovoFixture: 'counter' });

const COUNT = '[data-bind="count.count"]';

test('increments via mutation + morph, without navigating', async ({ page, kovoApp }) => {
  await page.goto('/');
  await expect(page.locator(COUNT)).toHaveText('0');

  await Promise.all([
    page.waitForResponse(
      (response) =>
        response.url().endsWith('/_m/counter/increment') && response.status() === 200,
    ),
    page.getByRole('button', { name: 'Increment' }).click(),
  ]);

  // The badge morphed in place — bound text updates with no full navigation.
  await expect(page.locator(COUNT)).toHaveText('1');
  expect(new URL(page.url()).pathname).toBe('/');

  // Server truth: the write actually hit the database.
  const rows = await kovoApp.db.query('select value from counter where id = 1');
  expect(rows[0]).toEqual({ value: 1 });

  // Semantic snapshot of the morphed host.
  expect(await kovoApp.semantic('[kovo-fragment-target="count-badge"]')).toMatchSnapshot(
    'count-badge.semantic.txt',
  );
});

test('isolates state between tests (db reset)', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator(COUNT)).toHaveText('0');
});
