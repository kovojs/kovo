import { expect, test } from '@kovojs/test/internal/integration';

// SPEC §10.3/§10.4 (plans/bugs-and-testing.md C6; testing-audit §5.2): two distinct
// mutations writing the same row concurrently must both land — neither lost to a
// read-modify-write race across overlapping request lifecycles/transactions.
test.use({ kovoFixture: 'concurrent-distinct-writes' });

test('two overlapping distinct writes both apply (no lost update)', async ({ kovoApp, request }) => {
  // Fire both mutations concurrently; their handlers sleep before the atomic increment
  // so the request lifecycles genuinely overlap.
  const [a, b] = await Promise.all([
    request.post('/_m/concurrent-distinct-writes/a', { form: {}, maxRedirects: 0 }),
    request.post('/_m/concurrent-distinct-writes/b', { form: {}, maxRedirects: 0 }),
  ]);
  expect(a.status()).toBe(303);
  expect(b.status()).toBe(303);

  // Both increments landed: 0 + 10 + 1. A lost update would leave 10 or 1.
  const rows = await kovoApp.db.query('select count from counter where id = 1');
  expect(rows[0]).toEqual({ count: 11 });
});
