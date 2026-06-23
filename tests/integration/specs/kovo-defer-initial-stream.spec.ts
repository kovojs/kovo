import { expect, test } from '@kovojs/test/internal/integration';

test.use({ kovoFixture: 'kovo-defer-initial-stream' });

test('kovo-defer fallback morphs to initial streamed fragment with query truth first', async ({
  page,
  kovoApp,
  request,
}) => {
  const raw = await request.get('/');
  expect(raw.status()).toBe(200);
  const html = await raw.text();
  const fallbackIndex = html.indexOf('data-testid="reviews-fallback"');
  const boundaryIndex = html.indexOf('--kovo-boundary');
  expect(fallbackIndex).toBeGreaterThan(-1);
  expect(boundaryIndex).toBeGreaterThan(fallbackIndex);

  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'Reviews ready' })).toBeVisible();
  await expect(page.locator('[kovo-c="reviews:p1"] [data-bind="reviews.count"]')).toHaveText('1');
  await expect(page.locator('kovo-defer[target="reviews:p1"]')).toHaveCount(0);
  await expect(page.locator('kovo-query,kovo-fragment')).toHaveCount(0);
  await expect(page.locator('body')).not.toContainText('--kovo-boundary');

  expect(await kovoApp.semantic('[kovo-c="reviews:p1"]')).toMatchSnapshot(
    'kovo-defer-initial-stream.semantic.txt',
  );
});
