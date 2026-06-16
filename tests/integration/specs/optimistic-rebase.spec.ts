// SPEC.md §10.4: pending optimistic transforms for one query must rebase in
// order as server truth arrives out of order.
import { test } from '@kovojs/test/integration';

test.skip(
  true,
  'Blocked by current fixture bootstrap: end-to-end browser fixtures cannot yet attach the per-query optimistic log and rebase protocol that runtime unit tests cover, so concurrent optimistic reconciliation is not reachable here.',
);

test('rebases still-pending optimistic transforms over arriving server truth', async () => {});
