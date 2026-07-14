import { query } from '@kovojs/server';

// Query-backed component roots receive compiler-owned island identities. The
// query carries no data authority; the fixture's mutation-owned stream owns the
// explicit replacement under test.
export const runnerQuery = query('loaderRunner', {
  load: () => ({ ready: true }),
  reads: [],
});
