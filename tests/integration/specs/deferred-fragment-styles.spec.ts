import { expect, test } from '@kovojs/test/integration';

test.use({ kovoFixture: 'deferred-fragment-styles' });

test('deferred fragments reuse page stylesheet metadata without duplicate links', async ({
  page,
  request,
  kovoApp,
}) => {
  await page.goto('/');
  await expect(page.getByText('Loading reviews')).toBeVisible();
  await expect(
    page.locator('link[rel="stylesheet"][href="/assets/deferred-review.css"]'),
  ).toHaveCount(0);
  await page.waitForFunction(() => typeof window.applyDeferredCssStream === 'function');

  const stream = await request.get('/deferred-wire');
  expect(stream.status()).toBe(200);
  const body = await stream.text();
  expect(body).toContain('<kovo-fragment target="deferred-review" mode="append">');
  expect(body).toContain('href="/assets/deferred-review.css"');

  await page.evaluate(async (streamBody) => {
    await (
      window as typeof window & { applyDeferredCssStream?: (body: string) => unknown }
    ).applyDeferredCssStream?.(streamBody);
  }, body);

  const card = page.locator('[data-review-card]');
  await expect(card).toHaveText('Deferred review ready');
  await expect(card).toHaveCSS('background-color', 'rgb(12, 84, 96)');
  await expect(
    page.locator('link[rel="stylesheet"][href="/assets/deferred-review.css"]'),
  ).toHaveCount(1);

  expect(await kovoApp.semantic('[kovo-fragment-target="deferred-review"]')).toMatchSnapshot(
    'deferred-fragment-styles.semantic.txt',
  );
});
