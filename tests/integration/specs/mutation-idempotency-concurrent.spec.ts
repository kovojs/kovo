// SPEC.md §9.1/§10.3: simultaneous enhanced submissions with one Kovo-Idem
// execute once and replay the reserved response to the duplicate.
import { expect, test } from '@kovojs/test/internal/integration';

test.use({ kovoFixture: 'mutation-idempotency-concurrent' });

test('coalesces concurrent duplicate enhanced mutation submissions', async ({
  page,
  request,
  kovoApp,
}) => {
  await page.goto('/');
  const token = await page.locator('input[name="kovo-csrf"]').inputValue();
  const post = () =>
    request.post('/_m/mutation-idempotency-concurrent/record', {
      form: { note: 'race', 'kovo-csrf': token },
      headers: {
        'Kovo-Fragment': 'true',
        'Kovo-Idem': 'idem-concurrent-1',
        'Kovo-Targets': 'idem-concurrent-status',
      },
    });

  const [first, duplicate] = await Promise.all([post(), post()]);
  expect(first.status()).toBe(200);
  expect(duplicate.status()).toBe(200);
  expect(first.headers()['kovo-idem']).toBe('idem-concurrent-1');
  expect(duplicate.headers()['kovo-idem']).toBe('idem-concurrent-1');

  const [firstBody, duplicateBody] = await Promise.all([first.text(), duplicate.text()]);
  expect(firstBody).toBe(duplicateBody);
  expect(firstBody).toContain('data-bind="idem.count">1');

  const rows = await kovoApp.db.query(
    'select count(*)::int as count, array_agg(note order by note) as notes from concurrent_entries',
  );
  expect(rows[0]).toEqual({ count: 1, notes: ['race'] });
});
