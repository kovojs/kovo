import { expect, test } from '@kovojs/test/internal/integration';

test.use({ kovoFixture: 'browser-posture-isolated' });

test('enables exact cross-origin isolation in every supported engine', async ({ page }) => {
  const response = await page.goto('/');
  expect(response?.status()).toBe(200);
  expect(response?.headers()['cross-origin-opener-policy']).toBe('same-origin');
  expect(response?.headers()['cross-origin-embedder-policy']).toBe('require-corp');
  expect(response?.headers()['cross-origin-resource-policy']).toBe('same-origin');
  expect(await page.evaluate(() => globalThis.crossOriginIsolated)).toBe(true);
});
