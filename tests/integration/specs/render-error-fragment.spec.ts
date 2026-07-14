// SPEC.md §9.2: render failures after commit are stable and keep sanitized changes.
import { expect, test } from '@kovojs/test/internal/integration';

test.use({ kovoFixture: 'render-error-fragment' });

test('returns render-error fragment after a committed mutation render failure', async ({
  page,
  kovoApp,
}) => {
  await page.goto('/');
  const [response] = await Promise.all([
    page.waitForResponse((candidate) =>
      candidate.url().endsWith('/_m/render-error-fragment/create'),
    ),
    page.getByRole('button', { name: 'Create receipt' }).click(),
  ]);
  const body = await response.text();

  expect(response.status()).toBe(500);
  expect(body).toContain('data-error-code="RENDER_ERROR"');
  expect(body).not.toContain('receipt renderer leaked details');
  expect(response.headers()['kovo-changes']).toBe('[{"domain":"receipt","keys":["r1"]}]');
  expect(response.headers()['kovo-changes']).not.toContain('committed-secret');

  const rows = await kovoApp.db.query('select id, secret from receipts');
  expect(rows).toEqual([{ id: 'r1', secret: 'committed-secret' }]);
});
