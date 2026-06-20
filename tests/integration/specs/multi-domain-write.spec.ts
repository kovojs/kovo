import { expect, test } from '@kovojs/test/internal/integration';

// SPEC §11.1/§11.2, KV402 (plans/bugs-and-testing.md C7; testing-audit §5.1):
// a single handler writing two domains. Both-declared passes and fans out to both
// consumers; omitting one domain fails loudly naming the MISSING one.
test.use({ kovoFixture: 'multi-domain-write' });

test('a two-domain write with both declared fans out to both consumers, no diagnostics', async ({
  page,
  kovoApp,
}) => {
  await page.goto('/');
  await expect(page.getByTestId('cart-count')).toHaveText('0');
  await expect(page.getByTestId('product-stock')).toHaveText('5');

  await Promise.all([
    page.waitForResponse(
      (r) => r.url().endsWith('/_m/multi-domain-write/add-both') && r.status() === 200,
    ),
    page.getByRole('button', { name: 'Add both' }).click(),
  ]);

  // Both domain consumers refreshed from one mutation.
  await expect(page.getByTestId('cart-count')).toHaveText('1');
  await expect(page.getByTestId('product-stock')).toHaveText('4');
  expect(kovoApp.verificationDiagnostics()).toEqual([]);

  const cartRows = await kovoApp.db.query('select count(*)::int as count from cart_items');
  expect(cartRows[0]).toEqual({ count: 1 });
});

test('omitting one of two written domains raises KV402 naming the missing domain', async ({
  request,
}) => {
  const response = await request.post('/_m/multi-domain-write/add-partial', {
    form: {},
    headers: { 'Kovo-Fragment': 'true' },
  });

  expect(response.status()).toBe(500);
  const body = await response.text();
  expect(body).toContain('KV402');
  // The diagnostic must name the specific silently-stale domain, not just "a domain".
  expect(body).toContain('product');
});
