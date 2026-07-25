// SPEC.md §9.1: Kovo-Changes contains only sanitized domain/key metadata.
import { expect, test } from '@kovojs/test/internal/integration';

test.use({ kovoFixture: 'sanitized-kovo-changes' });

test('omits mutation input and diagnostics from Kovo-Changes', async ({
  page,
  request,
  kovoApp,
}) => {
  await page.goto('/');
  const build = (await page.locator('meta[name="kovo-build"]').getAttribute('content')) ?? '';
  const idem = await page.locator('input[name="Kovo-Idem"]').inputValue();
  const response = await request.post('/_m/sanitized-kovo-changes/save', {
    form: { id: 'r1', secret: 'sensitive-token', 'Kovo-Idem': idem },
    headers: {
      'Kovo-Build': build,
      'Kovo-Current-Url': page.url(),
      'Kovo-Fragment': 'true',
      'Kovo-Idem': idem,
    },
  });

  expect(response.status()).toBe(200);
  const changes = response.headers()['kovo-changes'];
  expect(JSON.parse(changes ?? 'null')).toEqual([{ domain: 'audit-record', keys: ['r1'] }]);
  expect(changes).not.toContain('sensitive-token');
  expect(changes).not.toContain('internal-stack-detail');
  expect(changes).not.toContain('secret:');

  const rows = await kovoApp.db.query('select id, secret from audit_records');
  expect(rows).toEqual([{ id: 'r1', secret: 'sensitive-token' }]);
});
