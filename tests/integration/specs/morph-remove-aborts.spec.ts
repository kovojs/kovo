// SPEC.md §4.4/§4.7: removing an island through a fragment morph aborts its
// ctx.signal and does not let removed handlers or pending triggers produce later effects.
import { expect, test } from '@kovojs/test/integration';

test.use({ kovoFixture: 'morph-remove-aborts' });

test('aborts removed island handlers and leaves replacement inert until touched', async ({
  kovoApp,
  page,
}) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Morph remove aborts' })).toBeVisible();
  await expect(page.locator('[data-morph-abort-status]')).toHaveText('idle');

  await page.getByRole('button', { name: 'Start abortable' }).click();
  await expect(page.locator('[data-morph-abort-status]')).toHaveText('running');

  await Promise.all([
    page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          window.addEventListener('kovo:morph-remove-abort', () => resolve(), { once: true });
        }),
    ),
    page.waitForResponse(
      (response) =>
        response.url().endsWith('/_m/morph-remove-aborts/remove') && response.status() === 200,
    ),
    page.getByRole('button', { name: 'Remove island' }).click(),
  ]);

  await expect(page.locator('[data-morph-abort-status]')).toHaveText('aborted');
  await expect(page.locator('[data-morph-stage="removed"]')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Touch replacement' })).toBeVisible();
  await page.waitForTimeout(250);
  await expect
    .poll(() => page.evaluate(() => window.__morphRemoveAborts?.aborted ?? []))
    .toEqual(['abortable']);
  await expect
    .poll(() => page.evaluate(() => window.__morphRemoveAborts?.sideEffects ?? []))
    .toEqual([]);
  await expect
    .poll(() => page.evaluate(() => window.__morphRemoveAborts?.starts ?? []))
    .toEqual(['abortable']);

  await page.getByRole('button', { name: 'Touch replacement' }).click();
  await expect(page.locator('[data-morph-abort-status]')).toHaveText('replacement-touched');
  await expect
    .poll(() => page.evaluate(() => window.__morphRemoveAborts?.starts ?? []))
    .toEqual(['abortable', 'replacement']);

  expect(await kovoApp.semantic('[data-morph-stage="removed"]')).toMatchSnapshot(
    'morph-remove-aborts-shell.semantic.txt',
  );
});
