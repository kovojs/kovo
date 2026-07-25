import { expect, test } from '@kovojs/test/internal/integration';

test.use({ kovoFixture: 'touch-graph-runtime-crosscheck' });

test('verifies observed mutation writes against the static touch graph', async ({
  page,
  kovoApp,
}) => {
  await page.goto('/');
  await expect(page.getByTestId('cart-count')).toHaveText('0');

  await Promise.all([
    page.waitForResponse(
      (response) =>
        response.url().endsWith('/_m/touch-graph-runtime-crosscheck/add') &&
        response.status() === 200,
    ),
    page.getByRole('button', { name: 'Add item' }).click(),
  ]);

  await expect(page.getByTestId('cart-count')).toHaveText('1');
  const rows = await kovoApp.db.query('select product_id from cart_items order by product_id');
  expect(rows).toEqual([{ product_id: 'p1' }]);
  expect(await kovoApp.verificationDiagnostics()).toEqual([]);
});

test('fails loudly when a mutation smuggles a write outside its touch set', async ({
  kovoApp,
  request,
}) => {
  const documentResponse = await request.get('/');
  const documentHtml = await documentResponse.text();
  const build = documentHtml.match(/<meta name="kovo-build" content="([^"]+)"/)?.[1] ?? '';
  const idem = documentHtml.match(/name="Kovo-Idem" value="([^"]+)"/)?.[1] ?? '';
  expect(build).not.toBe('');
  expect(idem).not.toBe('');
  const response = await request.post('/_m/touch-graph-runtime-crosscheck/smuggle', {
    form: { productId: 'p2', 'Kovo-Idem': idem },
    headers: {
      'Kovo-Build': build,
      'Kovo-Current-Url': documentResponse.url(),
      'Kovo-Fragment': 'true',
      'Kovo-Idem': idem,
    },
  });

  expect(response.status()).toBe(500);
  const body = await response.text();
  expect(body).toContain('data-error-code="SERVER_ERROR"');
  const rows = await kovoApp.db.query('select product_id from audit_log order by product_id');
  expect(rows).toEqual([]);
});
