import { expect, test } from '@kovojs/test/internal/integration';

// SPEC §9.2/§10.3, §11.4 pillar 5 (plans/bugs-and-testing.md C7; testing-audit §5.1):
// a real Postgres unique-violation inside a transactional domain write surfaces a
// sanitized error, rolls back the whole transaction, and leaves no partial state.
test.use({ kovoFixture: 'pg-constraint-failure' });

test('a real unique-PK violation rolls back the transaction and sanitizes the error', async ({
  kovoApp,
  request,
}) => {
  const enhanced = await request.post('/_m/pg-constraint-failure/charge', {
    form: { id: 'c1' },
    headers: { 'Kovo-Fragment': 'true', 'Kovo-Targets': 'charge-status' },
  });

  expect(enhanced.status()).toBe(500);
  const body = await enhanced.text();
  // Typed, sanitized failure — never the raw engine error / "duplicate key" detail.
  expect(body).toContain('data-error-code="SERVER_ERROR"');
  expect(body.toLowerCase()).not.toContain('duplicate key');
  expect(body.toLowerCase()).not.toContain('constraint');

  // The whole transaction rolled back: the pre-write is gone and the seed row is intact.
  const ledger = await kovoApp.db.query('select note from ledger');
  expect(ledger).toEqual([]);
  const charges = await kovoApp.db.query('select id, amount from charges order by id');
  expect(charges).toEqual([{ amount: 100, id: 'c1' }]);

  // No-JS path: same sanitized 500, same rollback.
  const noJs = await request.post('/_m/pg-constraint-failure/charge', { form: { id: 'c1' } });
  expect(noJs.status()).toBe(500);
  expect(await noJs.text()).toBe('Internal Server Error');
  expect(await kovoApp.db.query('select note from ledger')).toEqual([]);
});
