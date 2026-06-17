// SPEC.md §10.4 and §9.2: failed optimistic predictions must roll back shared
// query state and then render the typed error fragment.
import { expect, test } from '@kovojs/test/integration';

test.use({ kovoFixture: 'optimistic-rollback' });

test('rolls back optimistic state and shows the typed error fragment on failure', async ({
  page,
  kovoApp,
}) => {
  await page.goto('/');
  await page.waitForFunction(
    () =>
      (window as typeof window & { __optimisticRollbackReady?: boolean })
        .__optimisticRollbackReady === true,
  );

  const panel = page.locator('#cart-panel');
  const count = panel.locator('[data-bind="cart.count"]');
  await expect(count).toHaveText('4');
  await expect(page.locator('[data-error-code]')).toHaveCount(0);

  const responsePromise = page.waitForResponse(
    (response) =>
      response.url().endsWith('/_m/optimistic-rollback/add') && response.status() === 422,
  );
  await page.getByRole('button', { name: 'Add optimistically' }).click();

  await expect(count).toHaveText('6');
  await expect(panel).toHaveAttribute('kovo-pending', '');
  await expect(panel).toHaveAttribute('aria-busy', 'true');

  await responsePromise;
  await expect(count).toHaveText('4');
  await expect(panel).not.toHaveAttribute('kovo-pending', '');
  await expect(panel).not.toHaveAttribute('aria-busy', 'true');
  await expect(page.getByRole('alert')).toHaveAttribute('data-error-code', 'OUT_OF_STOCK');
  await expect(page.getByRole('alert')).toHaveText('Only 0 available');

  const rows = await kovoApp.db.query<{ count: number }>(
    'select count from optimistic_cart where id = 1',
  );
  expect(Number(rows[0]?.count)).toBe(4);
});
