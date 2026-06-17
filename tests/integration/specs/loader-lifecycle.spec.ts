// SPEC.md §4.4/§4.7: delegated handlers start on interaction, keep a live
// ctx.signal, and abort when a fragment morph removes their island.
import { test } from '@kovojs/test/internal/integration';
import { expect } from '@kovojs/test/internal/integration';

test.use({ kovoFixture: 'loader-lifecycle' });

test('aborts a running island handler when an enhanced morph removes its island', async ({
  page,
  kovoApp,
}) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Loader lifecycle' })).toBeVisible();
  await expect(page.locator('[data-lifecycle-status]')).toHaveText('idle');
  await expect(page.getByRole('button', { name: 'Start primary task' })).toBeVisible();

  await page.getByRole('button', { name: 'Start primary task' }).click();
  await expect(page.locator('[data-lifecycle-status]')).toHaveText('primary-running');
  await expect
    .poll(() => page.evaluate(() => window.__loaderLifecycle?.starts ?? []))
    .toEqual(['primary']);

  await Promise.all([
    page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          window.addEventListener('kovo:loader-lifecycle-abort', () => resolve(), {
            once: true,
          });
        }),
    ),
    page.waitForResponse(
      (response) =>
        response.url().endsWith('/_m/loader-lifecycle/swap') && response.status() === 200,
    ),
    page.getByRole('button', { name: 'Swap island' }).click(),
  ]);

  await expect(page.locator('[data-lifecycle-status]')).toHaveText('primary-aborted');
  await expect(page.getByRole('button', { name: 'Replacement task' })).toBeVisible();
  await expect(page.locator('[data-stage="replaced"]')).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => window.__loaderLifecycle?.aborted ?? []))
    .toEqual(['primary']);
  await expect
    .poll(() => page.evaluate(() => window.__loaderLifecycle?.starts ?? []))
    .toEqual(['primary']);

  await page.getByRole('button', { name: 'Replacement task' }).click();
  await expect(page.locator('[data-lifecycle-status]')).toHaveText('replacement-running');
  await expect
    .poll(() => page.evaluate(() => window.__loaderLifecycle?.starts ?? []))
    .toEqual(['primary', 'replacement']);

  expect(await kovoApp.semantic('[data-stage="replaced"]')).toMatchSnapshot(
    'loader-lifecycle-shell.semantic.txt',
  );
});
