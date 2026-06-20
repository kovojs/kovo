// SPEC.md §10.4: optimistic query predictions should update all dependent
// consumers before server truth, then reconcile cleanly on success.
import { expect, test } from '@kovojs/test/internal/integration';

test.use({ kovoFixture: 'optimistic-success' });

test('reconciles a successful optimistic mutation across all query consumers', async ({
  page,
  kovoApp,
}) => {
  await page.goto('/');
  await page.waitForFunction(
    () =>
      (window as typeof window & { __optimisticSuccessReady?: boolean })
        .__optimisticSuccessReady === true,
  );

  const panel = page.locator('#cart-panel');
  const count = panel.locator('[data-bind="cart.count"]');
  await expect(count).toHaveText('1');
  await expect(panel).not.toHaveAttribute('kovo-pending', '');

  const responsePromise = page.waitForResponse(
    (response) =>
      response.url().endsWith('/_m/optimistic-success/add') && response.status() === 200,
  );
  await page.getByRole('button', { name: 'Add optimistically' }).click();

  await expect(count).toHaveText('3');
  await expect(panel).toHaveAttribute('kovo-pending', '');
  await expect(panel).toHaveAttribute('aria-busy', 'true');

  await responsePromise;
  await expect(count).toHaveText('4');
  await expect(panel).not.toHaveAttribute('kovo-pending', '');
  await expect(panel).not.toHaveAttribute('aria-busy', 'true');

  const rows = await kovoApp.db.query<{ count: number }>(
    'select count from optimistic_cart where id = 1',
  );
  expect(Number(rows[0]?.count)).toBe(4);
});

test("a sibling island's local state survives an optimistic mutation + morph (multi-feature, C8d)", async ({
  page,
}) => {
  await page.goto('/');
  await page.waitForFunction(
    () =>
      (window as typeof window & { __optimisticSuccessReady?: boolean })
        .__optimisticSuccessReady === true,
  );

  const toggle = page.getByTestId('toggle-state');
  const count = page.locator('#cart-panel [data-bind="cart.count"]');
  await expect(toggle).toHaveText('false');
  await expect(count).toHaveText('1');

  // User sets the sibling island's local state.
  await page.getByRole('button', { name: 'toggle' }).click();
  await expect(toggle).toHaveText('true');

  // Fire the optimistic mutation: it predicts the cart count and morphs the cart panel.
  const responsePromise = page.waitForResponse(
    (response) =>
      response.url().endsWith('/_m/optimistic-success/add') && response.status() === 200,
  );
  await page.getByRole('button', { name: 'Add optimistically' }).click();
  await expect(count).toHaveText('3'); // optimistic prediction
  await responsePromise;
  await expect(count).toHaveText('4'); // reconciled to server truth

  // The sibling island (outside the morphed fragment) keeps its local state through
  // the whole optimistic + reconcile + morph cycle — no cross-feature interference.
  await expect(toggle).toHaveText('true');
});
