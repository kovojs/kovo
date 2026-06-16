// SPEC.md §10.4 and §9.2: failed optimistic predictions must roll back shared
// query state and then render the typed error fragment.
import { test } from '@kovojs/test/integration';

test.skip(
  true,
  'Blocked by current fixture bootstrap: optimistic transforms and rollback hooks exist in @kovojs/runtime, but fixture apps do not yet have a framework-supported way to wire optimistic plans into enhanced browser submits.',
);

test('rolls back optimistic state and shows the typed error fragment on failure', async () => {});
