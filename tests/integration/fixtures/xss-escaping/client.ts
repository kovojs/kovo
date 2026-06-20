import { createQueryStore } from '@kovojs/browser/client';
import { installInlineQueryEventHydration } from '@kovojs/browser/internal/inline-loader';

installInlineQueryEventHydration({
  root: document,
  store: createQueryStore(),
  target: window,
});
