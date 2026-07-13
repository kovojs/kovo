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
  const target = page.locator('[kovo-fragment-target="idem-status"]');
  const liveTarget = [
    await target.getAttribute('kovo-fragment-target'),
    '#',
    await target.getAttribute('kovo-live-component'),
    '@',
    await target.getAttribute('kovo-live-token'),
    ':',
    (await target.getAttribute('kovo-props')) ?? '{}',
  ].join('');

  const first = await request.post('/_m/idempotent-mutation/record', {
    form: { note: 'first', 'kovo-csrf': token },
    headers: {
      'Kovo-Fragment': 'true',
      'Kovo-Idem': 'idem-integration-1',
      'Kovo-Current-Url': page.url(),
      'Kovo-Live-Targets': liveTarget,
      'Kovo-Targets': 'idem-status=idem',
      origin,
    },
  });
  const firstBody = await first.text();
  expect(first.status()).toBe(200);
  expect(firstBody).toContain('<output data-bind="idem.count"');
  expect(firstBody).toContain('>1</output>');

  const duplicate = await request.post('/_m/idempotent-mutation/record', {
    form: { note: 'first', 'kovo-csrf': token },
    headers: {
      'Kovo-Fragment': 'true',
      'Kovo-Idem': 'idem-integration-1',
      'Kovo-Current-Url': page.url(),
      'Kovo-Live-Targets': liveTarget,
      'Kovo-Targets': 'idem-status=idem',
      origin,
    },
  });
  expect(duplicate.status()).toBe(200);
  expect(await duplicate.text()).toBe(firstBody);

  const rows = await kovoApp.db.query('select count(*)::int as count from ledger_entries');
  expect(rows[0]).toEqual({ count: 1 });
});
