import { s, task } from '@kovojs/server';

export const rebuildSearch = task({
  input: s.object({ index: s.string() }),
  retry: { backoff: 'exponential', maxAttempts: 4 },
  run: ({ index }) => ({ rebuilt: index }),
});
