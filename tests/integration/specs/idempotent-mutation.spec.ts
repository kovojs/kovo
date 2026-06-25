// SPEC.md §9.1/§10.3: duplicate Kovo-Idem submissions replay without re-running writes.
import { expect, test } from '@kovojs/test/internal/integration';

test.use({ kovoFixture: 'idempotent-mutation' });

test('replays duplicate idempotency keys without executing the write twice', async ({
  page,
  request,
  kovoApp,
}) => {
  await page.goto('/');
  const origin = new URL(page.url()).origin;
  const token = await page.locator('input[name="kovo-csrf"]').inputValue();

  const first = await request.post('/_m/idempotent-mutation/record', {
    form: { note: 'first', 'kovo-csrf': token },
    headers: {
      'Kovo-Fragment': 'true',
      'Kovo-Idem': 'idem-integration-1',
      'Kovo-Targets': 'idem-status',
      origin,
    },
  });
  const firstBody = await first.text();
  expect(first.status()).toBe(200);
  expect(firstBody).toContain('data-bind="idem.count">1');

  const duplicate = await request.post('/_m/idempotent-mutation/record', {
    form: { note: 'first', 'kovo-csrf': token },
    headers: {
      'Kovo-Fragment': 'true',
      'Kovo-Idem': 'idem-integration-1',
      'Kovo-Targets': 'idem-status',
      origin,
    },
  });
  expect(duplicate.status()).toBe(200);
  expect(await duplicate.text()).toBe(firstBody);

  const rows = await kovoApp.db.query('select count(*)::int as count from ledger_entries');
  expect(rows[0]).toEqual({ count: 1 });
});
