// SPEC.md §8: Speculation Rules stay default-off and emit only on routes that opt in.
import { expect, test } from '@kovojs/test/internal/integration';

test.use({ kovoFixture: 'speculation-rules-opt-in' });

test('emits one speculationrules script only for the opted-in route', async ({ page, request }) => {
  const defaultResponse = await request.get('/');
  expect(defaultResponse.status()).toBe(200);
  const defaultHtml = await defaultResponse.text();
  expect(defaultHtml).not.toContain('type="speculationrules"');

  const prerenderedResponse = await request.get('/prerendered');
  expect(prerenderedResponse.status()).toBe(200);
  const prerenderedHtml = await prerenderedResponse.text();
  const matches =
    prerenderedHtml.match(/<script\b[^>]*\btype="speculationrules"[^>]*>[\s\S]*?<\/script>/g) ?? [];
  expect(matches).toHaveLength(1);
  expect(prerenderedHtml).toContain('"eagerness":"conservative"');
  expect(prerenderedHtml).toContain('"/products/sku-1"');
  expect(prerenderedHtml).toContain('"/search?q=trail+pack"');

  await page.goto('/prerendered');
  await expect(page.getByRole('heading', { name: 'Prerendered route' })).toBeVisible();
  await expect(page.locator('script[type="speculationrules"]')).toHaveCount(1);
});
