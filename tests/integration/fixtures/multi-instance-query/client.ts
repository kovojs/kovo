import { createQueryStore, installInlineQueryEventHydration } from '@kovojs/runtime';

installInlineQueryEventHydration({
  root: document,
  store: createQueryStore(),
  target: window,
});
