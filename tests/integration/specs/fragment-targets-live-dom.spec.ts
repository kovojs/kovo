// SPEC.md §9.1: enhanced requests derive Kovo-Targets from current live DOM.
import { expect, test } from '@kovojs/test/integration';

test.use({ kovoFixture: 'fragment-targets-live-dom' });

test('includes patched-in fragment targets in later enhanced mutation requests', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('[data-bind="wire.stage"]')).toHaveText('Stage 0');

  await Promise.all([
    page.waitForResponse(
      (response) =>
        response.url().endsWith('/_m/fragment-targets-live-dom/advance') &&
        response.status() === 200,
    ),
    page.getByRole('button', { name: 'Install panel' }).click(),
  ]);
  await expect(page.locator('[data-bind="wire.dynamic"]')).toHaveText('Panel 1');

  const secondRequest = page.waitForRequest((request) => {
    if (!request.url().endsWith('/_m/fragment-targets-live-dom/advance')) return false;
    const targets = request.headers()['kovo-targets'] ?? '';
    return targets.includes('dynamic-panel=wire');
  });
  await Promise.all([
    page.waitForResponse(
      (response) =>
        response.url().endsWith('/_m/fragment-targets-live-dom/advance') &&
        response.status() === 200,
    ),
    page.getByRole('button', { name: 'Refresh panel' }).click(),
    secondRequest,
  ]);

  await expect(page.locator('[data-bind="wire.dynamic"]')).toHaveText('Panel 2');
});
