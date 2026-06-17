// SPEC.md §8/§11.4: Firefox and WebKit must keep the MPA baseline usable while
// Chromium remains the full-suite baseline. This spec is the representative
// cross-engine matrix for L0 document navigation, L1 form submission, and L2
// loader/query enhancement behavior.
import { expect, test } from '@kovojs/test/integration';

test.use({ kovoFixture: 'browser-engine-degradation-matrix' });

test('keeps representative L0/L1/L2 behavior working across browser engines', async ({
  page,
  kovoApp,
}) => {
  const response = await page.goto('/');
  expect(response?.status()).toBe(200);

  await expect(page.getByRole('heading', { name: 'Engine matrix' })).toBeVisible();
  await expect(page.locator('[data-bind="greeting"]')).toHaveText('Welcome');
  await page.waitForFunction(
    () =>
      (window as typeof window & { __engineMatrixReady?: boolean }).__engineMatrixReady === true,
  );

  const form = page.locator('#engine-matrix-form');
  await expect(form).toHaveAttribute('method', 'post');
  await expect(form).toHaveAttribute('action', '/_m/engine-matrix/submit');

  const [nativePostResponse] = await Promise.all([
    page.waitForResponse((mutationResponse) =>
      mutationResponse.url().endsWith('/_m/engine-matrix/submit'),
    ),
    page.getByRole('button', { name: 'Submit matrix form' }).click(),
  ]);
  expect(nativePostResponse.status()).toBe(303);
  await expect(page.getByRole('heading', { name: 'Engine matrix' })).toBeVisible();

  await expect(page.locator('[data-submit-report]')).toContainText('quantity=2; includeGift=true');
  await expect(
    kovoApp.db.query('select quantity, include_gift from engine_matrix_submit_log order by id'),
  ).resolves.toEqual([{ include_gift: 1, quantity: 2 }]);

  await expect(page.locator('engine-matrix-card [data-bind="engine.message"]')).toHaveText(
    'Initial message',
  );

  await kovoApp.db.exec(
    "update engine_matrix_state set message = 'Externally changed' where id = 1",
  );

  const refetchResponse = page.waitForResponse(
    (queryResponse) => queryResponse.url().endsWith('/_q/engine') && queryResponse.status() === 200,
  );
  await page.evaluate(() => {
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await refetchResponse;

  await expect(page.locator('engine-matrix-card [data-bind="engine.message"]')).toHaveText(
    'Externally changed',
  );
  expect(new URL(page.url()).pathname).toBe('/');
});
