import { expect, test } from '@kovojs/test/internal/integration';

test.use({ kovoFixture: 'exempt-table-read-fails' });

test('rejects query reads from tables marked write-side exempt', async ({ request }) => {
  const response = await request.get('/_q/audit-read');

  expect(response.status()).toBe(500);
  const body = await response.text();
  expect(body).toContain('KV411');
  expect(body).toContain('audit_log');
});
