// SPEC.md §9.1: Kovo-Changes contains only sanitized domain/key metadata.
import { expect, test } from '@kovojs/test/internal/integration';

test.use({ kovoFixture: 'sanitized-kovo-changes' });

test('omits mutation input and diagnostics from Kovo-Changes', async ({ request, kovoApp }) => {
  const response = await request.post('/_m/sanitized-kovo-changes/save', {
    form: { id: 'r1', secret: 'sensitive-token' },
    headers: { 'Kovo-Fragment': 'true' },
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
