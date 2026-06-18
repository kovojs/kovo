import { createQueryStore, installInlineQueryEventHydration } from '@kovojs/runtime/client';

installInlineQueryEventHydration({
  root: document,
  store: createQueryStore(),
  target: window,
});
