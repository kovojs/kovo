import { expect, test } from '@kovojs/test/internal/integration';

test.use({ kovoFixture: 'browser-posture-interoperable' });

test('retains the conservative default when frames and popups are present', async ({ page }) => {
  const response = await page.goto('/');
  expect(response?.status()).toBe(200);
  expect(response?.headers()['cross-origin-opener-policy']).toBe(
    'same-origin-allow-popups; report-to="kovo-csp"',
  );
  expect(response?.headers()['cross-origin-embedder-policy']).toBeUndefined();
  expect(response?.headers()['cross-origin-resource-policy']).toBeUndefined();
  expect(await page.evaluate(() => globalThis.crossOriginIsolated)).toBe(false);
  await expect(page.getByTitle('Embed fixture')).toBeVisible();
  const popupPromise = page.waitForEvent('popup');
  await page.getByRole('link', { name: 'Open OAuth fixture' }).click();
  const popup = await popupPromise;
  await expect(popup.getByText('OAuth callback fixture')).toBeVisible();
  await popup.close();
});
