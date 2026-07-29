import { defineKovo, s } from '@kovojs/server';

const app = defineKovo({
  appId: '7719fe41-b5b2-44c8-81da-0d8ff0ce35b0',
});

export const rebuildSearch = app.task({
  input: s.object({ index: s.string() }),
  retry: { backoff: 'exponential', maxAttempts: 4 },
  run: ({ index }) => ({ rebuilt: index }),
});
