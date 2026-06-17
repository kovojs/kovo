// SPEC.md §10.2 KV410 + §11.2: opaque read projections must be backed by a
// declared output schema, and the live typed-read path verifies observed rows.
import { expect, test } from '@kovojs/test/integration';

test.use({ kovoFixture: 'opaque-projection-schema' });

test('renders matching opaque projections through the declared output schema', async ({ page }) => {
  await page.goto('/');

  await expect(page.locator('[data-bind="projection-good.label"]')).toHaveText('Keyboard (KB-1)');
  await expect(page.locator('[data-bind="projection-good.stock"]')).toHaveText('7');
});

test('reports KV410 for drifted opaque projection output without leaking row internals', async ({
  request,
}) => {
  const response = await request.get('/_q/projection-drift');

  expect(response.status()).toBe(500);
  await expect(response.text()).resolves.toBe('{"code":"KV410","payload":{}}');
});
