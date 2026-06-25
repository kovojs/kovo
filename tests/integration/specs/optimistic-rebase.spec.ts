// SPEC.md §10.4: pending optimistic transforms for one query must rebase in
// order as server truth arrives out of order.
import { expect, test } from '@kovojs/test/internal/integration';

test.use({ kovoFixture: 'optimistic-rebase' });

test('rebases still-pending optimistic transforms over arriving server truth @race-prone', async ({
  page,
  kovoApp,
}) => {
  await page.goto('/');
  await page.waitForFunction(
    () =>
      (window as typeof window & { __optimisticRebaseReady?: boolean }).__optimisticRebaseReady ===
      true,
  );

  const panel = page.locator('#cart-panel');
  const count = panel.locator('[data-bind="cart.count"]');
  await expect(count).toHaveText('0');

  const nextRebaseResponse = () =>
    page.waitForResponse(
      (response) =>
        response.url().endsWith('/_m/optimistic-rebase/add') && response.status() === 200,
    );

  await page.getByRole('button', { name: 'Add first' }).click();
  await expect(count).toHaveText('2');
  await expect(panel).toHaveAttribute('kovo-pending', '');

  await page.getByRole('button', { name: 'Add second' }).click();
  await expect(count).toHaveText('7');
  await expect(panel).toHaveAttribute('aria-busy', 'true');

  expect(
    await page.evaluate(
      () =>
        (
          window as typeof window & { __optimisticRebasePendingCount?: () => number }
        ).__optimisticRebasePendingCount?.() ?? -1,
    ),
  ).toBe(2);

  await page.waitForTimeout(900);
  await expect(count).toHaveText('7');
  let rows = await kovoApp.db.query<{ count: number }>(
    'select count from optimistic_cart where id = 1',
  );
  expect(Number(rows[0]?.count)).toBe(2);

  const secondResponse = nextRebaseResponse();
  await secondResponse;
  await expect(count).toHaveText('7');
  await expect(panel).not.toHaveAttribute('kovo-pending', '');
  await expect(panel).not.toHaveAttribute('aria-busy', 'true');

  rows = await kovoApp.db.query<{ count: number }>(
    'select count from optimistic_cart where id = 1',
  );
  expect(Number(rows[0]?.count)).toBe(7);
});
