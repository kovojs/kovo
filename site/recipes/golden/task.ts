import { s } from '@kovojs/server';
import { task } from '@kovojs/server/tasks';

export const rebuildSearch = task({
  input: s.object({ index: s.string() }),
  retry: { backoff: 'exponential', maxAttempts: 4 },
  run: ({ index }) => ({ rebuilt: index }),
});
