import { createQueryStore } from '@kovojs/runtime/client';
import { installInlineQueryEventHydration } from '@kovojs/runtime/internal/inline-loader';

installInlineQueryEventHydration({
  root: document,
  store: createQueryStore(),
  target: window,
});
